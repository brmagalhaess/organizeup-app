import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail, sendEmailInBackground, type EmailMessage } from "./email";

vi.mock("server-only", () => ({}));

const message: EmailMessage = {
  to: "ana@example.com",
  subject: "Assunto sigiloso",
  html: "<p>Corpo sigiloso</p>",
  text: "Corpo sigiloso",
  template: "redefinir-senha",
};

function logged(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map((call) => String(call[0])).join("\n");
}

describe("sendEmail", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("BREVO_API_KEY", "chave-de-teste");
    vi.stubEnv("EMAIL_FROM_NAME", "");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "");
    vi.stubEnv("EMAIL_CAPTURE_FILE", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("chama a Brevo no formato documentado, com o remetente padrão", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 201 }));

    await expect(sendEmail(message)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "api-key": "chave-de-teste",
      "content-type": "application/json",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      sender: { name: "OrganizeUp", email: "notificacoes@organizeup.com.br" },
      to: [{ email: "ana@example.com" }],
      subject: "Assunto sigiloso",
      htmlContent: "<p>Corpo sigiloso</p>",
      textContent: "Corpo sigiloso",
      tags: ["redefinir-senha"],
    });
  });

  it("usa o remetente das variáveis", async () => {
    vi.stubEnv("EMAIL_FROM_NAME", "Outro Nome");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "outro@example.com");
    fetchMock.mockResolvedValue(new Response("{}", { status: 201 }));

    await sendEmail(message);

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.sender).toEqual({ name: "Outro Nome", email: "outro@example.com" });
  });

  it("sem a chave não lança, não chama a rede e avisa só o modelo", async () => {
    vi.stubEnv("BREVO_API_KEY", "");

    await expect(sendEmail(message)).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      JSON.stringify({ level: "warn", msg: "email_disabled", template: "redefinir-senha" }),
    );
  });

  it("EMAIL_ENABLED=false desliga o envio mesmo com a chave", async () => {
    vi.stubEnv("EMAIL_ENABLED", "false");

    await expect(sendEmail(message)).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aceita os nomes BREVO_SENDER_NAME e BREVO_SENDER_EMAIL", async () => {
    vi.stubEnv("EMAIL_FROM_NAME", "");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "");
    vi.stubEnv("BREVO_SENDER_NAME", "Nome Brevo");
    vi.stubEnv("BREVO_SENDER_EMAIL", "brevo@example.com");

    await sendEmail(message);

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.sender).toEqual({ name: "Nome Brevo", email: "brevo@example.com" });
  });

  it("falha da Brevo loga só modelo e status, mesmo se a resposta repetir os dados", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "ana@example.com recusado" }), { status: 400 }),
    );

    await expect(sendEmail(message)).resolves.toBe(false);

    expect(JSON.parse(logged(error))).toEqual({
      level: "error",
      msg: "email_failed",
      template: "redefinir-senha",
      status: 400,
    });
  });

  it("erro de rede não lança e não vaza a mensagem do erro", async () => {
    fetchMock.mockRejectedValue(new Error("falhou para ana@example.com"));

    await expect(sendEmail(message)).resolves.toBe(false);

    expect(JSON.parse(logged(error)).status).toBe("network");
    expect(logged(error)).not.toContain("ana@example.com");
  });

  it("estouro do tempo limite é logado como timeout", async () => {
    fetchMock.mockRejectedValue(new DOMException("tempo", "TimeoutError"));

    await expect(sendEmail(message)).resolves.toBe(false);

    expect(JSON.parse(logged(error)).status).toBe("timeout");
  });

  it("disparo em segundo plano não espera a Brevo", async () => {
    let finish = (_response: Response) => {};
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    await expect(sendEmailInBackground(message)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledOnce();
    finish(new Response("{}", { status: 201 }));
  });

  describe("captura para o e2e", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(path.join(tmpdir(), "email-capture-"));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("grava a mensagem e não chama a rede", async () => {
      const file = path.join(dir, "emails.jsonl");
      vi.stubEnv("EMAIL_CAPTURE_FILE", file);

      await expect(sendEmail(message)).resolves.toBe(true);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(message);
    });

    it("é ignorada com NODE_ENV=production", async () => {
      const file = path.join(dir, "emails.jsonl");
      vi.stubEnv("EMAIL_CAPTURE_FILE", file);
      vi.stubEnv("NODE_ENV", "production");
      fetchMock.mockResolvedValue(new Response("{}", { status: 201 }));

      await expect(sendEmail(message)).resolves.toBe(true);

      expect(fetchMock).toHaveBeenCalledOnce();
      await expect(readFile(file, "utf8")).rejects.toThrow();
    });
  });
});
