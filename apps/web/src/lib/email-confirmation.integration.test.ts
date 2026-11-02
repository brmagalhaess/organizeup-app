// Confirmação de e-mail com o auth.ts real, contra um Postgres real, lendo o link no arquivo de captura. Só o
// que o Next.js dá por requisição é simulado: cabeçalhos, cookies, cache e textos. Dados fictícios.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const adminEmail = `admin-${randomUUID()}@example.com`;
const folder = await mkdtemp(path.join(tmpdir(), "confirmar-email-"));
const captureFile = path.join(folder, "emails.jsonl");

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.AUTH_RATE_LIMIT = "disabled";
process.env.ADMIN_EMAILS = adminEmail;
process.env.EMAIL_CAPTURE_FILE = captureFile;

let requestHeaders = new Headers();
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// Simula só o resultado da corrida: `storeIdentity` recusa depois de a reserva ter passado.
const forced = vi.hoisted(() => ({ result: null as "refused" | "unavailable" | null }));
vi.mock("@/lib/identity", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/identity")>();
  return {
    ...real,
    storeIdentity: async (...args: Parameters<typeof real.storeIdentity>) =>
      forced.result ?? real.storeIdentity(...args),
  };
});
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { messagesFor } = await import("@/i18n/messages");
  return {
    getLocale: async () => "pt-BR",
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "pt-BR", messages: messagesFor("pt-BR"), namespace } as never),
  };
});

const db = await import("@organizeup/db");
const { createEmailVerificationToken } = await import("better-auth/api");
const { getAuth } = await import("@/lib/auth");
const { sendConfirmation } = await import("@/lib/email-confirmation");
const { resendConfirmation } = await import("@/app/(auth)/confirmar-email/actions");
const { resendUserConfirmation } = await import("@/app/admin/usuarios/actions");

const ORIGIN = "http://localhost:3000";

type Captured = { to: string; template: string; text: string };

async function captured(to: string) {
  const content = await readFile(captureFile, "utf8").catch(() => "");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Captured)
    .filter((email) => email.to === to && email.template === "confirmar-email");
}

const linkIn = (email: Captured | undefined) => email?.text.match(/https?:\/\/\S+/)?.[0] ?? "";

const post = (route: string, body: unknown, cookie = "") =>
  getAuth().handler(
    new Request(`${ORIGIN}/api/auth${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
      body: JSON.stringify(body),
    }),
  );

const signUpRequest = (email: string) =>
  post("/sign-up/email", {
    name: "Pessoa Teste",
    email,
    password: "Senha#1234",
    termsAccepted: true,
    identity: { inBrazil: false },
  });

const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

/** O cadastro envia em segundo plano: espera o primeiro e-mail, para os testes contarem só os seguintes. */
async function signUp(email: string) {
  const response = await signUpRequest(email);
  expect(response.status).toBe(200);
  await vi.waitFor(async () => expect(await captured(email)).toHaveLength(1));
  const { user } = (await response.json()) as { user: { id: string } };
  return { id: user.id, email, cookie: cookieOf(response) };
}

/** O e-mail do cadastro ocupa a vaga do minuto: adianta o relógio em vez de esperar de verdade. */
const afterTheMinute = () => vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61 * 1000 });

/** Dá tempo ao envio em segundo plano antes de contar o que não deveria ter saído. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 400));

const newAccount = () => signUp(`pessoa-${randomUUID()}@example.com`);

const openLink = (link: string, cookie = "") =>
  getAuth().handler(new Request(link, { method: "GET", headers: { cookie } }));

const landing = (response: Response) => response.headers.get("location") ?? "";

async function tokenFor(email: string, expiresIn: number) {
  const { secret } = await getAuth().$context;
  return createEmailVerificationToken(secret, email, undefined, expiresIn);
}

const verifyUrl = (token: string, callback = "%2Fconfirmar-email") =>
  `${ORIGIN}/api/auth/verify-email?token=${token}&callbackURL=${callback}`;

const isVerified = async (id: string) =>
  (await (await getAuth().$context).internalAdapter.findUserById(id))?.emailVerified;

const setMaintenance = (enabled: boolean) =>
  db.adminSetFlag(
    { adminUserId: "user-teste" },
    { key: db.FLAG_KEYS.maintenance, enabled, action: "controles:manutencao" },
  );

const asAccount = (cookie: string) => {
  requestHeaders = new Headers({ cookie });
};

afterEach(async () => {
  process.env.EMAIL_CAPTURE_FILE = captureFile;
  forced.result = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.closeAllPools();
});

describe("reenvio pela sessão", () => {
  it("envia para o e-mail da própria conta e o segundo pedido espera", async () => {
    const account = await newAccount();
    const other = await newAccount();
    asAccount(account.cookie);
    afterTheMinute();

    expect(await resendConfirmation()).toEqual({
      ok: true,
      message: "Enviado. Confira sua caixa de entrada e o spam. O link vale 24 horas.",
    });
    expect(await captured(account.email)).toHaveLength(2);
    expect(await captured(other.email)).toHaveLength(1);

    const second = await resendConfirmation();
    expect(second.ok).toBe(false);
    expect(second.message).toMatch(/^Aguarde \d+ segundos? para pedir de novo\.$/);
    expect(await captured(account.email)).toHaveLength(2);
  });

  it("sem sessão não envia nada", async () => {
    asAccount("");
    await expect(resendConfirmation()).rejects.toMatchObject({
      digest: expect.stringContaining("/entrar"),
    });
  });

  it("a rota pública do Better Auth, que aceita qualquer e-mail, fica fechada", async () => {
    const account = await newAccount();
    const response = await getAuth().handler(
      new Request(`${ORIGIN}/api/auth/send-verification-email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ email: account.email }),
      }),
    );
    expect(response.status).toBe(404);
    expect(await captured(account.email)).toHaveLength(1);
  });

  it("quem já confirmou não recebe outro e-mail", async () => {
    const account = await newAccount();
    await openLink(linkIn((await captured(account.email))[0]));
    const verified = await signIn(account.email);
    asAccount(verified);
    expect(await resendConfirmation()).toEqual({
      ok: true,
      message: "Seu e-mail já está confirmado.",
    });
    expect(await captured(account.email)).toHaveLength(1);
  });

  it("com e-mail desligado a tela diz que nada saiu, e o limite não conta", async () => {
    const account = await newAccount();
    asAccount(account.cookie);
    delete process.env.EMAIL_CAPTURE_FILE;
    const reply = await resendConfirmation();
    expect(reply.ok).toBe(false);
    expect(reply.message).toContain("Nada foi enviado");
    process.env.EMAIL_CAPTURE_FILE = captureFile;
    afterTheMinute();
    expect((await resendConfirmation()).ok).toBe(true);
  });

  it("se o envio falha, não finge que saiu e a vaga volta", async () => {
    const account = await newAccount();
    asAccount(account.cookie);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    afterTheMinute();
    process.env.EMAIL_CAPTURE_FILE = folder;
    expect(await resendConfirmation()).toEqual({
      ok: false,
      message: "Não foi possível enviar agora. Tente de novo.",
    });
    process.env.EMAIL_CAPTURE_FILE = captureFile;
    expect((await resendConfirmation()).ok).toBe(true);
  });

  it("não envia na manutenção nem para conta bloqueada", async () => {
    const account = await newAccount();
    asAccount(account.cookie);
    await setMaintenance(true);
    const reply = await resendConfirmation().finally(() => setMaintenance(false));
    expect(reply.message).toContain("manutenção");
    expect(await captured(account.email)).toHaveLength(1);

    const target = { ...account, name: "Pessoa Teste", emailVerified: false };
    await db.adminSetUserBlocked({ adminUserId: "user-teste" }, account.id, true);
    expect(await sendConfirmation(target, "pt-BR")).toEqual({ status: "bloqueada" });
    await expect(resendConfirmation()).rejects.toMatchObject({
      digest: expect.stringContaining("/entrar"),
    });
    expect(await captured(account.email)).toHaveLength(1);
  });
});

describe("cadastro recusado depois da reserva", () => {
  it.each(["refused", "unavailable"] as const)(
    "%s: sem conta, sem e-mail e sem Set-Cookie na resposta de erro",
    async (result) => {
      const email = `recusa-${randomUUID()}@example.com`;
      forced.result = result;
      const response = await signUpRequest(email);
      forced.result = null;
      await settled();
      expect(response.status).toBe(400);
      expect(await response.text()).toMatch(/DOCUMENT_(REFUSED|UNAVAILABLE)/);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await captured(email)).toEqual([]);
      const { internalAdapter } = await getAuth().$context;
      expect(await internalAdapter.findUserByEmail(email)).toBeNull();
    },
  );

  it("cadastro que passa continua com sessão e e-mail", async () => {
    const account = await newAccount();
    expect(account.cookie).toContain("session_token");
    expect(await captured(account.email)).toHaveLength(1);
  });

  it("o idioma escolhido antes da conta já vale para o primeiro e-mail", async () => {
    const email = `idioma-${randomUUID()}@example.com`;
    const response = await getAuth().handler(
      new Request(`${ORIGIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          cookie: "organizeup_locale=en",
        },
        body: JSON.stringify({
          name: "Pessoa Teste",
          email,
          password: "Senha#1234",
          termsAccepted: true,
          identity: { inBrazil: false },
        }),
      }),
    );
    expect(response.status).toBe(200);
    await vi.waitFor(async () => expect(await captured(email)).toHaveLength(1));
    const [mail] = await captured(email);
    expect(mail?.text).toContain("Confirm");
  });
});

describe("limite por endereço", () => {
  const MINUTE = 60 * 1000;
  const start = Date.now();
  const at = (minutes: number) => new Date(start + minutes * MINUTE);

  it("1 por minuto e 5 por hora, com o tempo certo de espera", async () => {
    const id = `${randomUUID()}@example.com`;
    expect(await db.reserveConfirmationEmail(id, at(0))).toHaveProperty("id");
    expect(await db.reserveConfirmationEmail(id, new Date(at(0).getTime() + 15_000))).toEqual({
      retryAfterSeconds: 45,
    });
    for (const minute of [1, 2, 3, 4]) {
      expect(await db.reserveConfirmationEmail(id, at(minute))).toHaveProperty("id");
    }
    expect(await db.reserveConfirmationEmail(id, at(10))).toEqual({ retryAfterSeconds: 50 * 60 });
    expect(await db.reserveConfirmationEmail(id, at(60))).toHaveProperty("id");
    expect(await db.reserveConfirmationEmail(randomUUID(), at(10))).toHaveProperty("id");
  });

  it("caixa e espaço não abrem outra vaga, e o endereço não fica gravado", async () => {
    const email = `caixa-${randomUUID()}@example.com`;
    expect(await db.reserveConfirmationEmail(email)).toHaveProperty("id");
    expect(await db.reserveConfirmationEmail(`  ${email.toUpperCase()} `)).toHaveProperty(
      "retryAfterSeconds",
    );
    const rows = await db.withAdmin("leitura do teste de limite", (admin) =>
      admin.select({ identifier: db.verification.identifier }).from(db.verification),
    );
    expect(JSON.stringify(rows)).not.toContain(email);
  });

  it("o e-mail do cadastro conta: reenviar logo depois espera", async () => {
    const account = await newAccount();
    asAccount(account.cookie);
    expect((await resendConfirmation()).message).toMatch(/^Aguarde/);
    expect(await captured(account.email)).toHaveLength(1);
  });

  it("e-mail do cadastro que não saiu devolve a vaga", async () => {
    const email = `falhou-${randomUUID()}@example.com`;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.EMAIL_CAPTURE_FILE = folder;
    const response = await signUpRequest(email);
    await settled();
    process.env.EMAIL_CAPTURE_FILE = captureFile;
    expect(response.status).toBe(200);
    asAccount(cookieOf(response));
    expect((await resendConfirmation()).ok).toBe(true);
  });

  it("cadastrar, apagar e repetir não passa de 1 por minuto nem de 5 por hora, sem revelar conta", async () => {
    const email = `alvo-${randomUUID()}@example.com`;
    const round = async () => {
      const response = await signUpRequest(email);
      const body = (await response.json()) as { user: Record<string, unknown> };
      const cookie = cookieOf(response);
      asAccount(cookie);
      await resendConfirmation();
      const removed = await post("/delete-user", { password: "Senha#1234" }, cookie);
      expect(removed.status).toBe(200);
      return { status: response.status, keys: Object.keys(body.user).sort(), cookie: !!cookie };
    };

    const first = await round();
    const repeated = [await round(), await round()];
    await settled();
    expect(await captured(email)).toHaveLength(1);
    // Com ou sem e-mail, a resposta do cadastro é a mesma.
    expect(first).toMatchObject({ status: 200, cookie: true });
    for (const answer of repeated) expect(answer).toEqual(first);

    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let minute = 1; minute <= 9; minute += 1) {
      vi.setSystemTime(start + minute * 61 * 1000);
      await round();
    }
    await settled();
    expect(await captured(email)).toHaveLength(5);

    vi.setSystemTime(start + 61 * 60 * 1000);
    await round();
    await settled();
    expect(await captured(email)).toHaveLength(6);
  });

  it("o nome de endereço com caixa diferente cai na mesma vaga do cadastro", async () => {
    const email = `caixa-alta-${randomUUID()}@example.com`;
    const first = await signUpRequest(email);
    await post("/delete-user", { password: "Senha#1234" }, cookieOf(first));
    expect((await signUpRequest(email.toUpperCase())).status).toBe(200);
    await settled();
    expect(await captured(email)).toHaveLength(1);
  });

  it("pedidos simultâneos, como de duas instâncias, ficam com uma vaga só", async () => {
    const id = randomUUID();
    const slots = await Promise.all(
      Array.from({ length: 6 }, () => db.reserveConfirmationEmail(id)),
    );
    expect(slots.filter((slot) => "id" in slot)).toHaveLength(1);
  });
});

async function signIn(email: string) {
  const response = await getAuth().handler(
    new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email, password: "Senha#1234" }),
    }),
  );
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

describe("volta do link", () => {
  it("link do e-mail confirma sem abrir sessão: quem tem o link não entra na conta", async () => {
    const account = await newAccount();
    const response = await openLink(linkIn((await captured(account.email))[0]));
    expect(response.status).toBe(302);
    expect(landing(response)).toBe("/confirmar-email?estado=confirmado");
    expect(response.headers.getSetCookie().join()).not.toContain("session_token");
    expect(await isVerified(account.id)).toBe(true);
  });

  it("com a sessão aberta confirma do mesmo jeito", async () => {
    const account = await newAccount();
    const link = linkIn((await captured(account.email))[0]);
    const response = await openLink(link, account.cookie);
    expect(landing(response)).toBe("/confirmar-email?estado=confirmado");
    const session = await getAuth().api.getSession({
      headers: new Headers({ cookie: account.cookie }),
    });
    expect(session?.user.emailVerified).toBe(true);
  });

  describe("com a sessão de outra conta aberta", () => {
    const sessionOf = async (cookie: string) =>
      getAuth().api.getSession({ headers: new Headers({ cookie }) });
    const NEUTRAL = "/confirmar-email?estado=outra-conta";

    it("confirma a dona do link, mostra a tela neutra e não mexe na conta aberta", async () => {
      const open = await newAccount();
      const owner = await newAccount();
      const response = await openLink(linkIn((await captured(owner.email))[0]), open.cookie);
      expect(landing(response)).toBe(NEUTRAL);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await isVerified(owner.id)).toBe(true);
      const session = await sessionOf(open.cookie);
      expect(session?.user).toMatchObject({ email: open.email, emailVerified: false });
    });

    it("a tela é a mesma se o link já tinha sido usado: nada se aprende da outra conta", async () => {
      const open = await newAccount();
      const owner = await newAccount();
      const link = linkIn((await captured(owner.email))[0]);
      await openLink(link);
      expect(landing(await openLink(link, open.cookie))).toBe(NEUTRAL);
    });

    it("a tela é a mesma se a outra conta está bloqueada, e ela não é confirmada", async () => {
      const open = await newAccount();
      const owner = await newAccount();
      await db.adminSetUserBlocked({ adminUserId: "user-teste" }, owner.id, true);
      const response = await openLink(linkIn((await captured(owner.email))[0]), open.cookie);
      expect(landing(response)).toBe(NEUTRAL);
      expect(await isVerified(owner.id)).toBe(false);
    });

    it("link inválido continua inválido", async () => {
      const open = await newAccount();
      const response = await openLink(verifyUrl("inventado"), open.cookie);
      expect(landing(response)).toBe("/confirmar-email?error=INVALID_TOKEN");
    });
  });

  it("link repetido não abre sessão e diz que já foi usado", async () => {
    const account = await newAccount();
    const link = linkIn((await captured(account.email))[0]);
    await openLink(link);
    const again = await openLink(link);
    expect(landing(again)).toBe("/confirmar-email?estado=ja-confirmado");
    expect(again.headers.getSetCookie()).toEqual([]);
  });

  it("link vencido não confirma, e o token não aparece no endereço nem no log", async () => {
    const account = await newAccount();
    const logged: unknown[][] = [];
    for (const level of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args) => void logged.push(args));
    }
    const token = await tokenFor(account.email, -60);
    const response = await openLink(verifyUrl(token));
    expect(landing(response)).toBe("/confirmar-email?error=TOKEN_EXPIRED");
    expect(await isVerified(account.id)).toBe(false);
    expect(JSON.stringify(logged)).not.toContain(token);
  });

  it("link inválido, sem token ou de outro segredo não confirma", async () => {
    const account = await newAccount();
    const forged = linkIn((await captured(account.email))[0]).replace(
      /token=[^.]+\.[^.]+\.[^&]+/,
      (t) => `${t.slice(0, -4)}AAAA`,
    );
    for (const [link, code] of [
      [verifyUrl("inventado"), "INVALID_TOKEN"],
      [verifyUrl(""), "INVALID_TOKEN"],
      [forged, "INVALID_TOKEN"],
      [`${ORIGIN}/api/auth/verify-email`, "INVALID_TOKEN"],
    ] as const) {
      const response = await openLink(link);
      expect(response.status).toBe(302);
      expect(landing(response)).toBe(`/confirmar-email?error=${code}`);
    }
    expect(await isVerified(account.id)).toBe(false);
  });

  it("conta que sumiu cai como link inválido", async () => {
    const response = await openLink(verifyUrl(await tokenFor("sumiu@example.com", 600)));
    expect(landing(response)).toBe("/confirmar-email?error=USER_NOT_FOUND");
  });

  it("endereço de volta de fora é ignorado", async () => {
    const account = await newAccount();
    const token = await tokenFor(account.email, 600);
    for (const callback of [
      "https%3A%2F%2Fexemplo.invalid%2Fx",
      "%2F%2Fexemplo.invalid",
      "%2Fapp",
    ]) {
      const response = await openLink(verifyUrl(token, callback));
      expect(landing(response)).toMatch(/^\/confirmar-email\?estado=/);
    }
    const expired = await openLink(
      verifyUrl(await tokenFor(account.email, -60), "https%3A%2F%2Fexemplo.invalid"),
    );
    expect(landing(expired)).toBe("/confirmar-email?error=TOKEN_EXPIRED");
  });

  it("conta bloqueada não confirma nem ganha sessão", async () => {
    const account = await newAccount();
    await db.adminSetUserBlocked({ adminUserId: "user-teste" }, account.id, true);
    const response = await openLink(linkIn((await captured(account.email))[0]));
    expect(landing(response)).toBe("/conta-bloqueada");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await isVerified(account.id)).toBe(false);
  });

  it("na manutenção não grava e avisa; depois o mesmo link vale", async () => {
    const account = await newAccount();
    const link = linkIn((await captured(account.email))[0]);
    await setMaintenance(true);
    const paused = await openLink(link).finally(() => setMaintenance(false));
    expect(landing(paused)).toBe("/confirmar-email?error=MAINTENANCE");
    expect(await isVerified(account.id)).toBe(false);
    expect(landing(await openLink(link))).toBe("/confirmar-email?estado=confirmado");
  });

  it("confirmar continua opcional para entrar", async () => {
    const account = await newAccount();
    expect(await signIn(account.email)).toContain("session_token");
    expect(await isVerified(account.id)).toBe(false);
  });
});

describe("reenvio pelo admin", () => {
  let adminCookie = "";

  beforeAll(async () => {
    adminCookie = (await signUp(adminEmail)).cookie;
  });

  const resendFor = (id: string) => {
    const form = new FormData();
    form.set("id", id);
    asAccount(adminCookie);
    return resendUserConfirmation(form);
  };

  it("envia, registra na auditoria e divide o limite com a pessoa", async () => {
    const account = await newAccount();
    afterTheMinute();
    const reply = await resendFor(account.id);
    expect(reply).toEqual({
      ok: true,
      message: "Confirmação enviada. A pessoa recebe o link por e-mail.",
    });
    const sent = await captured(account.email);
    expect(sent).toHaveLength(2);
    const actions = await db.adminAccessList({ target: account.id, limit: 10 });
    expect(actions.map((row) => row.action)).toEqual(["usuario:reenviar_confirmacao"]);

    expect((await resendFor(account.id)).message).toMatch(/^Limite de envios desta conta/);
    asAccount(account.cookie);
    expect((await resendConfirmation()).message).toMatch(/^Aguarde/);
    expect(await captured(account.email)).toHaveLength(2);
  });

  it("recusa conta confirmada, bloqueada, a própria e a que não existe", async () => {
    const confirmed = await newAccount();
    await openLink(linkIn((await captured(confirmed.email))[0]));
    expect(await resendFor(confirmed.id)).toEqual({
      ok: false,
      message: "Esta conta já confirmou o e-mail.",
    });

    const blocked = await newAccount();
    await db.adminSetUserBlocked({ adminUserId: "user-teste" }, blocked.id, true);
    expect((await resendFor(blocked.id)).message).toContain("bloqueada");

    const session = await getAuth().api.getSession({
      headers: new Headers({ cookie: adminCookie }),
    });
    expect((await resendFor(session!.user.id)).ok).toBe(false);
    expect((await resendFor(randomUUID())).message).toBe("Conta não encontrada.");
  });

  it("quem não é admin recebe 404", async () => {
    const account = await newAccount();
    asAccount(account.cookie);
    const form = new FormData();
    form.set("id", account.id);
    await expect(resendUserConfirmation(form)).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });
});
