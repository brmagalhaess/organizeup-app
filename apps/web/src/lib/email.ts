import "server-only";
import { appendFile } from "node:fs/promises";

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
const TIMEOUT_MS = 5_000;

export type EmailTemplate = "confirmar-email" | "convite" | "redefinir-senha" | "senha-alterada";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: EmailTemplate;
};

/** Só o e2e usa. O build de produção fixa NODE_ENV e este caminho deixa de existir. */
function captureFile() {
  if (process.env.NODE_ENV === "production") return undefined;
  return process.env.EMAIL_CAPTURE_FILE || undefined;
}

/** Regra 5: destinatário, assunto e corpo nunca vão para o log. */
function logFailure(template: EmailTemplate | "indefinido", status: number | string) {
  console.error(JSON.stringify({ level: "error", msg: "email_failed", template, status }));
}

/** O painel do serviço mostra só isto: nunca o valor da chave. */
export const emailConfigured = () =>
  Boolean(process.env.BREVO_API_KEY) && process.env.EMAIL_ENABLED !== "false";

/** Dá para enviar agora, pela Brevo ou pelo arquivo de captura do e2e? */
export const emailCanSend = () => Boolean(captureFile()) || emailConfigured();

/** Envia pela API da Brevo. Nunca lança: e-mail fora do ar não pode derrubar quem chamou. */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const { to, subject, html, text, template } = message;
  const capture = captureFile();
  if (capture) {
    try {
      await appendFile(capture, `${JSON.stringify(message)}\n`);
      return true;
    } catch {
      logFailure(template, "capture");
      return false;
    }
  }
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey || !emailConfigured()) {
    console.warn(JSON.stringify({ level: "warn", msg: "email_disabled", template }));
    return false;
  }
  try {
    const response = await fetch(BREVO_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          name: process.env.EMAIL_FROM_NAME || process.env.BREVO_SENDER_NAME || "OrganizeUp",
          email:
            process.env.EMAIL_FROM_ADDRESS ||
            process.env.BREVO_SENDER_EMAIL ||
            "notificacoes@organizeup.com.br",
        },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
        tags: [template],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) logFailure(template, response.status);
    return response.ok;
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    logFailure(template, timedOut ? "timeout" : "network");
    return false;
  }
}

/**
 * Dispara e devolve na hora, para os ganchos do Better Auth. O cadastro roda numa transação e
 * "esqueci a senha" não pode demorar mais quando a conta existe: esperar a Brevo aqui seguraria
 * uma conexão do banco e revelaria quais e-mails têm conta.
 */
export function sendEmailInBackground(
  message: EmailMessage | Promise<EmailMessage>,
): Promise<void> {
  // Montar a mensagem pode ler o idioma no banco: também fica fora do tempo de quem pediu.
  void Promise.resolve(message)
    .then(sendEmail)
    .catch(() => logFailure("indefinido", "render"));
  return Promise.resolve();
}
