// Verificação em duas etapas (ADR-0034) no auth.ts real, contra um Postgres real: ativar, entrar em duas
// etapas e conferir o código antes de uma ação que não volta. Dados fictícios.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.AUTH_RATE_LIMIT = "disabled";

vi.mock("@/lib/email", () => ({
  sendEmailInBackground: () => undefined,
  emailConfigured: () => false,
}));

// `verifySecondFactor` lê os cabeçalhos do pedido; aqui eles vêm do teste.
let currentCookie = "";
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: currentCookie }),
}));

const db = await import("@organizeup/db");
const { getAuth } = await import("@/lib/auth");
const { verifySecondFactor } = await import("@/lib/two-factor");

const ORIGIN = "http://localhost:3000";
const PASSWORD = "Senha#1234";

async function request(path: string, cookie: string, body?: unknown) {
  const response = await getAuth().handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    cookies: response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0]!)
      .join("; "),
  };
}

async function signUp(email: string) {
  const { cookies, status } = await request("/sign-up/email", "", {
    name: "Pessoa Teste",
    email,
    password: PASSWORD,
    termsAccepted: true,
    identity: { inBrazil: false },
  });
  expect(status).toBe(200);
  return cookies;
}

/** O otpauth:// traz o segredo em base32; o gerador do Better Auth quer o segredo cru. */
function base32Decode(encoded: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of encoded.replace(/=+$/, "").toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

async function codeFor(totpURI: string) {
  const secret = base32Decode(new URL(totpURI).searchParams.get("secret")!);
  const { code } = await getAuth().api.generateTOTP({ body: { secret } });
  return code;
}

describe("verificação em duas etapas", () => {
  const email = `dois-fatores-${randomUUID()}@example.com`;
  let cookie = "";
  let totpURI = "";
  let backupCodes: string[] = [];

  beforeAll(async () => {
    cookie = await signUp(email);
  });

  afterAll(async () => {
    await db.closeAllPools();
  });

  it("sem o fator ativo, entrar é só senha e a ação que não volta recusa", async () => {
    const session = await getAuth().api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.twoFactorEnabled).toBeFalsy();
    currentCookie = cookie;
    expect(await verifySecondFactor({ user: session!.user, code: "123456" })).toBe("nao_ativado");
  });

  it("ativa com a senha, lê o QR e confirma o primeiro código", async () => {
    const wrong = await request("/two-factor/enable", cookie, { password: "errada#1" });
    expect(wrong.status).toBe(400);

    const enabled = await request("/two-factor/enable", cookie, { password: PASSWORD });
    expect(enabled.status).toBe(200);
    totpURI = String(enabled.json.totpURI);
    backupCodes = enabled.json.backupCodes as string[];
    expect(totpURI).toContain("otpauth://totp/OrganizeUp:");
    expect(backupCodes).toHaveLength(8);

    // Pedido, mas ainda não confirmado: entrar continua só com senha.
    const before = await getAuth().api.getSession({ headers: new Headers({ cookie }) });
    expect(before?.user.twoFactorEnabled).toBeFalsy();

    const confirmed = await request("/two-factor/verify-totp", cookie, {
      code: await codeFor(totpURI),
    });
    expect(confirmed.status).toBe(200);
    // O plugin troca a sessão ao ativar.
    if (confirmed.cookies) cookie = confirmed.cookies;
    const after = await getAuth().api.getSession({ headers: new Headers({ cookie }) });
    expect(after?.user.twoFactorEnabled).toBe(true);
  });

  it("entrar passa a ter duas etapas: senha, depois o código", async () => {
    const first = await request("/sign-in/email", "", { email, password: PASSWORD });
    expect(first.status).toBe(200);
    expect(first.json.twoFactorRedirect).toBe(true);
    // Sem sessão ainda: só o cookie da etapa pendente.
    expect(first.cookies).toContain("two_factor");
    const noSession = await getAuth().api.getSession({
      headers: new Headers({ cookie: first.cookies }),
    });
    expect(noSession).toBeNull();

    const bad = await request("/two-factor/verify-totp", first.cookies, { code: "000000" });
    expect(bad.status).toBe(401);

    const second = await request("/two-factor/verify-totp", first.cookies, {
      code: await codeFor(totpURI),
    });
    expect(second.status).toBe(200);
    const session = await getAuth().api.getSession({
      headers: new Headers({ cookie: second.cookies }),
    });
    expect(session?.user.email).toBe(email);
  });

  it("confere o código antes de apagar: certo passa, errado recusa, reserva vale uma vez", async () => {
    const session = await getAuth().api.getSession({ headers: new Headers({ cookie }) });
    currentCookie = cookie;
    const user = session!.user;
    expect(await verifySecondFactor({ user, code: "" })).toBe("codigo_vazio");
    expect(await verifySecondFactor({ user, code: "000000" })).toBe("codigo_invalido");
    expect(await verifySecondFactor({ user, code: "abc" })).toBe("codigo_invalido");
    expect(await verifySecondFactor({ user, code: await codeFor(totpURI) })).toBe("ok");

    const backup = backupCodes[0]!;
    expect(await verifySecondFactor({ user, code: backup })).toBe("ok");
    expect(await verifySecondFactor({ user, code: backup })).toBe("codigo_invalido");
    // A conferência não troca a sessão de quem está logado.
    const same = await getAuth().api.getSession({ headers: new Headers({ cookie }) });
    expect(same?.session.id).toBe(session!.session.id);
  });

  it("desativar pede a senha e volta a entrar só com ela", async () => {
    const disabled = await request("/two-factor/disable", cookie, { password: PASSWORD });
    expect(disabled.status).toBe(200);
    const signIn = await request("/sign-in/email", "", { email, password: PASSWORD });
    expect(signIn.status).toBe(200);
    expect(signIn.json.twoFactorRedirect).toBeUndefined();
    expect(signIn.cookies).not.toContain("two_factor");
  });
});
