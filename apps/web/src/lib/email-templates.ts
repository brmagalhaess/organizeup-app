import type { EmailTemplate } from "./email";

export const RESET_LINK_HOURS = 1;
export const VERIFY_LINK_HOURS = 24;
export const INVITE_LINK_DAYS = 7;

const MAX_NAME_LENGTH = 80;

// Mesmas cores de globals.css (tema claro): e-mail não lê variável de CSS.
const COLOR = {
  brand: "#1f5641",
  brandDark: "#183c32",
  surface: "#ffffff",
  page: "#eaf3ee",
  text: "#1f2933",
  muted: "#52606d",
};

type RenderedEmail = { subject: string; html: string; text: string; template: EmailTemplate };

type Layout = {
  template: EmailTemplate;
  subject: string;
  heading: string;
  /** Parágrafos em texto puro: o escape é feito aqui, uma vez, só na versão HTML. */
  paragraphs: string[];
  action: { label: string; url: string };
  note?: string;
};

/** Links sempre a partir de BETTER_AUTH_URL, nunca do cabeçalho Host de quem pediu. */
export function appUrl(path: string) {
  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}${path}`;
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Nome vem do usuário: sem quebra de linha e curto, para o e-mail não virar mural de quem cadastra. */
function cleanName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH).trim();
}

function greeting(name: string) {
  const clean = cleanName(name);
  return clean ? `Olá, ${clean}!` : "Olá!";
}

function render({ template, subject, heading, paragraphs, action, note }: Layout): RenderedEmail {
  const url = escapeHtml(action.url);
  const body = paragraphs
    .map((text) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(text)}</p>`)
    .join("");
  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:24px 12px;background:${COLOR.page};color:${COLOR.text};font-family:Arial,Helvetica,sans-serif;font-size:16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${COLOR.surface};border-radius:12px">
<tr><td style="padding:24px 24px 0;font-size:18px;font-weight:bold;color:${COLOR.brandDark}">OrganizeUp</td></tr>
<tr><td style="padding:16px 24px 24px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${COLOR.brandDark}">${escapeHtml(heading)}</h1>
${body}
<p style="margin:24px 0"><a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:${COLOR.brand};color:#ffffff;font-weight:bold;text-decoration:none">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 8px;font-size:14px;color:${COLOR.muted}">Se o botão não abrir, copie este endereço no navegador:</p>
<p style="margin:0 0 16px;font-size:14px;word-break:break-all"><a href="${url}" style="color:${COLOR.brand}">${url}</a></p>
${note ? `<p style="margin:0;font-size:14px;color:${COLOR.muted}">${escapeHtml(note)}</p>` : ""}
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
  const text = [heading, ...paragraphs, `${action.label}: ${action.url}`, note ?? ""]
    .filter(Boolean)
    .join("\n\n");
  return { subject, html, text, template };
}

export function resetPasswordEmail({ name, token }: { name: string; token: string }) {
  return render({
    template: "redefinir-senha",
    subject: "Redefina sua senha do OrganizeUp",
    heading: "Redefina sua senha",
    paragraphs: [
      greeting(name),
      `Recebemos um pedido para trocar a senha da sua conta. O link vale ${RESET_LINK_HOURS} hora.`,
    ],
    action: {
      label: "Criar nova senha",
      url: appUrl(
        `/api/auth/reset-password/${encodeURIComponent(token)}?callbackURL=%2Fredefinir-senha`,
      ),
    },
    note: "Se não foi você, ignore este e-mail. Sua senha continua a mesma.",
  });
}

export function passwordChangedEmail({ name }: { name: string }) {
  return render({
    template: "senha-alterada",
    subject: "Sua senha do OrganizeUp foi alterada",
    heading: "Sua senha foi alterada",
    paragraphs: [greeting(name), "A senha da sua conta acabou de ser trocada."],
    action: { label: "Pedir nova senha", url: appUrl("/esqueci-senha") },
    note: "Se foi você, não precisa fazer nada. Se não foi, peça uma nova senha agora.",
  });
}

export function verifyEmail({ name, token }: { name: string; token: string }) {
  return render({
    template: "confirmar-email",
    subject: "Confirme seu e-mail no OrganizeUp",
    heading: "Confirme seu e-mail",
    paragraphs: [
      greeting(name),
      `Falta só confirmar que este e-mail é seu. O link vale ${VERIFY_LINK_HOURS} horas.`,
    ],
    action: {
      label: "Confirmar e-mail",
      url: appUrl(
        `/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=%2Fapp%2Fescolher`,
      ),
    },
    note: "Se você não criou esta conta, ignore este e-mail.",
  });
}

export function invitationEmail({
  id,
  familyName,
  inviterName,
}: {
  id: string;
  familyName: string;
  inviterName: string;
}) {
  return render({
    template: "convite",
    // Assunto fixo: nome digitado por outra pessoa só aparece dentro do e-mail.
    subject: "Você recebeu um convite no OrganizeUp",
    heading: "Você recebeu um convite",
    paragraphs: [
      `${cleanName(inviterName)} convidou você para acompanhar as finanças da família ${cleanName(familyName)} no OrganizeUp.`,
      `Entre ou crie sua conta com este mesmo e-mail. O convite vale ${INVITE_LINK_DAYS} dias.`,
    ],
    action: { label: "Ver convite", url: appUrl(`/convite/${encodeURIComponent(id)}`) },
    note: "Se você não conhece quem enviou, ignore este e-mail.",
  });
}
