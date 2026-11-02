// Cadastro com documento no auth.ts real, contra um Postgres real: recusa sem deixar rastro, IP confiável,
// teto de recusas, convite e chave trocada. CPF e CNPJ fictícios.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { TEST_DOCUMENT_KEY } from "@/test/document-key";

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
process.env.DOCUMENT_ENCRYPTION_KEY = TEST_DOCUMENT_KEY;
delete process.env.AUTH_RATE_LIMIT;

const emails: string[] = [];
vi.mock("@/lib/email", () => ({
  sendEmailInBackground: (message: Promise<{ to: string }>) => {
    void message.then(({ to }) => emails.push(to)).catch(() => undefined);
  },
  emailConfigured: () => false,
}));

const db = await import("@organizeup/db");
const { cnpjCheckDigits, cpfCheckDigits } = await import("@organizeup/domain");
const { getAuth } = await import("./auth");
const { documentKeyChanged } = await import("./identity");
const { REFUSAL_CEILING } = await import("./document-refusals");

const ORIGIN = "http://localhost:3000";
const cpf = (n: number) => {
  const base = `001${String(n).padStart(6, "0")}`;
  return base + cpfCheckDigits(base);
};
const cnpj = (n: number) => {
  const base = `00EF${String(n).padStart(8, "0")}`;
  return base + cnpjCheckDigits(base);
};
const pf = (n: number) => ({ inBrazil: true, personType: "pf", cpf: cpf(n) });

let nextIp = 1;
const freshIp = () => {
  nextIp += 1;
  return `198.18.${Math.floor(nextIp / 250)}.${nextIp % 250}`;
};

async function call(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await getAuth().handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-forwarded-for": freshIp(),
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    text: await response.text(),
    cookies: response.headers.getSetCookie(),
  };
}

const signUp = (
  email: string,
  identity: unknown,
  headers: Record<string, string> = {},
  extra: Record<string, unknown> = {},
) =>
  call(
    "/sign-up/email",
    { name: "Teste", email, password: "Senha#1234", termsAccepted: true, identity, ...extra },
    headers,
  );

const mail = () => `documento-${randomUUID()}@example.com`;
const accountOf = async (email: string) => {
  const rows = await db.withAdmin("teste de cadastro", (admin) =>
    admin.select().from(db.user).where(db.eq(db.user.email, email)),
  );
  return rows[0];
};
const identityOf = async (userId: string) => {
  const rows = await db.withAdmin("teste de cadastro", (admin) =>
    admin.select().from(db.userIdentity).where(db.eq(db.userIdentity.userId, userId)),
  );
  return rows[0];
};
/** Dá tempo aos e-mails, que saem em segundo plano. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  emails.length = 0;
});

afterAll(async () => {
  await db.closeAllPools();
});

describe("cadastro recusado", () => {
  beforeAll(async () => {
    expect((await signUp(mail(), pf(1))).status).toBe(200);
  });

  it("não deixa conta, cookie de sessão nem e-mail", async () => {
    const email = mail();
    const refused = await signUp(email, pf(1));
    await settled();
    expect(refused.status).toBe(400);
    expect(refused.text).toContain("DOCUMENT_REFUSED");
    expect(refused.cookies.filter((cookie) => cookie.includes("session"))).toEqual([]);
    expect(emails).toEqual([]);
    expect(await accountOf(email)).toBeUndefined();
  });

  it("não é refeito por quem acerta logo depois com outro CPF", async () => {
    const email = mail();
    expect((await signUp(email, pf(1))).status).toBe(400);
    const accepted = await signUp(email, pf(2));
    await settled();
    expect(accepted.status).toBe(200);
    expect(accepted.cookies.some((cookie) => cookie.includes("session"))).toBe(true);
    expect(emails).toEqual([email]);
  });

  it("dois cadastros ao mesmo tempo com o mesmo CPF: só um passa, e o outro não recebe nada", async () => {
    const [first, second] = [mail(), mail()];
    const results = await Promise.all([signUp(first, pf(3)), signUp(second, pf(3))]);
    await settled();
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    expect(emails).toHaveLength(1);
    const winners = await Promise.all([accountOf(first), accountOf(second)]);
    expect(winners.filter(Boolean)).toHaveLength(1);
  });

  it("depois de gravar, a reserva sai e o mesmo CPF pode responder por uma empresa", async () => {
    const company = {
      inBrazil: true,
      personType: "pj",
      cpf: cpf(1),
      cnpj: cnpj(1),
      companyName: "Empresa Exemplo",
    };
    expect((await signUp(mail(), company)).status).toBe(200);
    expect((await signUp(mail(), company)).status).toBe(400);
  });
});

describe("limite por IP", () => {
  const invalid = { inBrazil: true, personType: "pf", cpf: "1" };

  it("forjar a esquerda de x-forwarded-for não escapa do limite", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 22; attempt += 1) {
      const forged = `203.0.113.${attempt}, 192.0.2.77`;
      const { status } = await signUp(mail(), invalid, { "x-forwarded-for": forged });
      statuses.push(status);
    }
    expect(statuses.slice(0, 20).every((status) => status === 400)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });

  it("outro IP segue passando", async () => {
    expect((await signUp(mail(), invalid, { "x-forwarded-for": "192.0.2.78" })).status).toBe(400);
  });
});

describe("cadastro por convite", () => {
  it("é sempre de pessoa, mesmo que o pedido diga empresa", async () => {
    const owner = await signUp(mail(), pf(10));
    const cookie = owner.cookies.map((item) => item.split(";")[0]).join("; ");
    const headers = new Headers({ cookie });
    const organization = await getAuth().api.createOrganization({
      headers,
      body: { name: "Empresa", slug: `empresa-${randomUUID()}` },
    });
    const invited = mail();
    const invitation = await getAuth().api.createInvitation({
      headers,
      body: { email: invited, role: "adult", organizationId: organization!.id },
    });

    const company = {
      inBrazil: true,
      personType: "pj",
      cpf: cpf(11),
      cnpj: cnpj(2),
      companyName: "Outra",
    };
    const result = await signUp(invited, company, {}, { invitation: invitation.id });
    expect(result.status).toBe(200);
    const account = await accountOf(invited);
    expect(await identityOf(account!.id)).toMatchObject({
      personType: "pf",
      cnpjEncrypted: null,
      companyNameEncrypted: null,
    });
    // O CNPJ não foi reservado por quem nem é empresa.
    const free = { ...company, cpf: cpf(12) };
    expect((await signUp(mail(), free)).status).toBe(200);
  });
});

describe("chave trocada", () => {
  it("recusa documento novo em vez de deixar a duplicidade desligar calada", async () => {
    expect(await documentKeyChanged()).toBe(false);
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await documentKeyChanged()).toBe(true);
      const email = mail();
      const repeated = await signUp(email, pf(1));
      expect(repeated.status).toBe(503);
      expect(repeated.text).toContain("DOCUMENT_UNAVAILABLE");
      expect(await accountOf(email)).toBeUndefined();
      expect(JSON.stringify(error.mock.calls)).toContain("document_key_mismatch");
      // Quem mora fora não depende da chave.
      expect((await signUp(mail(), { inBrazil: false })).status).toBe(200);
    } finally {
      error.mockRestore();
      vi.unstubAllEnvs();
      process.env.DOCUMENT_ENCRYPTION_KEY = TEST_DOCUMENT_KEY;
    }
    expect(await documentKeyChanged()).toBe(false);
  });
});

// Fica por último: o teto vale para todo o processo até a hora virar.
describe("teto global de recusas", () => {
  it("segura quem já foi recusado, de qualquer IP, sem travar quem acerta", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repeatedIp = "192.0.2.90";
    expect((await signUp(mail(), pf(1), { "x-forwarded-for": repeatedIp })).status).toBe(400);
    for (let attempt = 0; attempt < REFUSAL_CEILING; attempt += 1) {
      expect((await signUp(mail(), pf(1))).status).toBe(400);
    }
    expect(JSON.stringify(error.mock.calls)).toContain("document_refusals_ceiling");
    error.mockRestore();

    // Nem o CPF livre passa por quem já foi recusado: sem consulta, não há o que aprender.
    const blocked = await signUp(mail(), pf(50), { "x-forwarded-for": repeatedIp });
    expect(blocked.status).toBe(429);
    expect(blocked.text).toContain("TOO_MANY_ATTEMPTS");

    // Quem acerta, de um IP limpo, se cadastra normalmente.
    expect((await signUp(mail(), pf(51))).status).toBe(200);
    // Quem mora fora não consulta nada.
    expect(
      (await signUp(mail(), { inBrazil: false }, { "x-forwarded-for": repeatedIp })).status,
    ).toBe(200);
  });
});
