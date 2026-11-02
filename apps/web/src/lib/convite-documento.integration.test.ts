// Aceite de convite com documento: a action de verdade, no auth.ts real, contra um Postgres real, só com a sessão
// e os cabeçalhos do Next.js simulados. CPF e CNPJ fictícios.
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
process.env.AUTH_RATE_LIMIT = "disabled";

const ORIGIN = "http://localhost:3000";
const state: { session: unknown; cookie: string; maintenance: boolean } = {
  session: null,
  cookie: "",
  maintenance: false,
};

vi.mock("@/lib/email", () => ({
  sendEmailInBackground: () => undefined,
  emailConfigured: () => false,
}));
vi.mock("@/lib/session", () => ({
  requireSession: async () => state.session,
  platformFlags: async () => ({ maintenance: state.maintenance }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: state.cookie, origin: ORIGIN }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, has: () => false }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

const db = await import("@organizeup/db");
const { cnpjCheckDigits, cpfCheckDigits } = await import("@organizeup/domain");
const { getAuth } = await import("./auth");
const { acceptInvite } = await import("@/app/(auth)/convite/[id]/actions");

const cpf = (n: number) => {
  const base = `002${String(n).padStart(6, "0")}`;
  return base + cpfCheckDigits(base);
};
const cnpj = (n: number) => {
  const base = `00CD${String(n).padStart(8, "0")}`;
  return base + cnpjCheckDigits(base);
};

async function signUp(email: string, identity: unknown) {
  const response = await getAuth().handler(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        name: "Teste",
        email,
        password: "Senha#1234",
        termsAccepted: true,
        identity,
      }),
    }),
  );
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

const mail = () => `convite-${randomUUID()}@example.com`;
const reason = "teste de convite";
const accountOf = async (email: string) => {
  const rows = await db.withAdmin(reason, (admin) =>
    admin.select().from(db.user).where(db.eq(db.user.email, email)),
  );
  return rows[0]!;
};
const identityOf = async (userId: string) => {
  const rows = await db.withAdmin(reason, (admin) =>
    admin.select().from(db.userIdentity).where(db.eq(db.userIdentity.userId, userId)),
  );
  return rows[0];
};

/** Conta de antes do pedido de documento. */
async function oldAccount() {
  const email = mail();
  const cookie = await signUp(email, { inBrazil: false });
  const account = await accountOf(email);
  await db.withAdmin(reason, (admin) =>
    admin.delete(db.userIdentity).where(db.eq(db.userIdentity.userId, account.id)),
  );
  return { account, cookie, email };
}

let ownerHeaders: Headers;
let organizationId = "";

const invite = async (email: string, role: "adult" | "viewer" = "adult") => {
  const invitation = await getAuth().api.createInvitation({
    headers: ownerHeaders,
    body: { email, role, organizationId },
  });
  return invitation.id;
};

async function accept(
  person: { account: { id: string; email: string; name: string }; cookie: string },
  fields: Record<string, string>,
) {
  state.session = { user: person.account, session: {} };
  state.cookie = person.cookie;
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return (await acceptInvite(form).catch((error: Error) => error.message)) as string;
}

const memberCount = async (userId: string) => {
  const rows = await db.withAdmin(reason, (admin) =>
    admin
      .select()
      .from(db.householdMember)
      .where(
        db.and(
          db.eq(db.householdMember.organizationId, organizationId),
          db.eq(db.householdMember.userId, userId),
        ),
      ),
  );
  return rows.length;
};

beforeAll(async () => {
  const owner = await signUp(mail(), {
    inBrazil: true,
    personType: "pj",
    cpf: cpf(100),
    cnpj: cnpj(100),
    companyName: "Empresa Exemplo",
  });
  ownerHeaders = new Headers({ cookie: owner });
  const organization = await getAuth().api.createOrganization({
    headers: ownerHeaders,
    body: { name: "Empresa", slug: `empresa-${randomUUID()}` },
  });
  organizationId = organization!.id;
  await db.markHouseholdAsCompany(organizationId);
  await signUp(mail(), { inBrazil: true, personType: "pf", cpf: cpf(101) });
});

beforeEach(() => {
  state.maintenance = false;
});

afterAll(async () => {
  await db.closeAllPools();
});

describe("aceitar convite com documento", () => {
  const document = (n: number) => ({ country: "BR", personType: "pf", cpf: cpf(n) });

  it("convite de outra pessoa não grava documento", async () => {
    const person = await oldAccount();
    const other = await invite(mail());
    const result = await accept(person, { id: other, ...document(110) });
    expect(result).toBe(`REDIRECT /convite/${other}?erro=1`);
    expect(await identityOf(person.account.id)).toBeUndefined();
  });

  it("convite cancelado não grava documento", async () => {
    const person = await oldAccount();
    const id = await invite(person.email);
    await getAuth().api.cancelInvitation({ headers: ownerHeaders, body: { invitationId: id } });
    const result = await accept(person, { id, ...document(111) });
    expect(result).toBe(`REDIRECT /convite/${id}?erro=1`);
    expect(await identityOf(person.account.id)).toBeUndefined();
  });

  it("convite vencido não grava documento", async () => {
    const person = await oldAccount();
    const id = await invite(person.email);
    await db.withAdmin(reason, (admin) =>
      admin
        .update(db.householdInvitation)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(db.eq(db.householdInvitation.id, id)),
    );
    const result = await accept(person, { id, ...document(112) });
    expect(result).toBe(`REDIRECT /convite/${id}?erro=1`);
    expect(await identityOf(person.account.id)).toBeUndefined();
  });

  it("na manutenção não grava documento nem entra", async () => {
    const person = await oldAccount();
    const id = await invite(person.email);
    state.maintenance = true;
    const result = await accept(person, { id, ...document(113) });
    expect(result).toBe(`REDIRECT /convite/${id}?erro=manutencao`);
    expect(await identityOf(person.account.id)).toBeUndefined();
    expect(await memberCount(person.account.id)).toBe(0);
  });

  it("depois de 5 tentativas por hora nem o CPF livre passa, e a conta não vira consulta de CPF", async () => {
    const person = await oldAccount();
    const id = await invite(person.email);
    const failed = `REDIRECT /convite/${id}?erro=documento`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await accept(person, { id, ...document(101) })).toBe(failed);
    }
    expect(await accept(person, { id, ...document(114) })).toBe(failed);
    expect(await identityOf(person.account.id)).toBeUndefined();
    expect(await memberCount(person.account.id)).toBe(0);
  });

  it("pedido de empresa vira pessoa: quem é convidado não abre CNPJ por aqui", async () => {
    const person = await oldAccount();
    const id = await invite(person.email);
    const result = await accept(person, {
      id,
      country: "BR",
      personType: "pj",
      cpf: cpf(115),
      cnpj: cnpj(101),
      companyName: "Outra Empresa",
    });
    expect(result).toBe("REDIRECT /app");
    expect(await identityOf(person.account.id)).toMatchObject({
      personType: "pf",
      cnpjHash: null,
      companyNameEncrypted: null,
    });
    expect(await memberCount(person.account.id)).toBe(1);
  });

  it("quem mora fora aceita sem documento", async () => {
    const person = await oldAccount();
    const id = await invite(person.email);
    expect(await accept(person, { id, country: "outro" })).toBe("REDIRECT /app");
    expect(await identityOf(person.account.id)).toMatchObject({
      inBrazil: false,
      personType: null,
    });
  });

  it("quem já tem documento aceita sem informar nada", async () => {
    const email = mail();
    const cookie = await signUp(email, { inBrazil: true, personType: "pf", cpf: cpf(116) });
    const account = await accountOf(email);
    const id = await invite(email);
    expect(await accept({ account, cookie }, { id })).toBe("REDIRECT /app");
    expect(await memberCount(account.id)).toBe(1);
  });
});
