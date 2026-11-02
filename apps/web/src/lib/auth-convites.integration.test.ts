// Convites: quem é só leitor não descobre o id de um convite pendente pela rota pública do Better Auth.
// Roda no auth.ts real, contra um Postgres real. Dados fictícios.
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

const db = await import("@organizeup/db");
const { getAuth } = await import("@/lib/auth");

const ORIGIN = "http://localhost:3000";

async function request(path: string, cookie: string, body?: unknown) {
  const response = await getAuth().handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: response.status, text: await response.text(), response };
}

async function signUp(email: string) {
  const { response, status } = await request("/sign-up/email", "", {
    name: "Pessoa Teste",
    email,
    password: "Senha#1234",
    termsAccepted: true,
    identity: { inBrazil: false },
  });
  expect(status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

describe("convites na rota pública", () => {
  const owner = `dono-${randomUUID()}@example.com`;
  const invited = `convidada-${randomUUID()}@example.com`;
  let ownerCookie = "";
  let organizationId = "";
  let invitationId = "";
  let invitedCookie = "";

  beforeAll(async () => {
    ownerCookie = await signUp(owner);
    const headers = new Headers({ cookie: ownerCookie });
    const organization = await getAuth().api.createOrganization({
      headers,
      body: { name: "Família Teste", slug: `teste-${randomUUID()}` },
    });
    organizationId = organization!.id;
    const invitation = await getAuth().api.createInvitation({
      headers,
      body: { email: invited, role: "adult", organizationId },
    });
    invitationId = invitation.id;
  });

  afterAll(async () => {
    await db.closeAllPools();
  });

  it("não devolve o id do convite a quem está logado", async () => {
    const query = `?organizationId=${organizationId}`;
    const listed = await request(`/organization/list-invitations${query}`, ownerCookie);
    const full = await request(`/organization/get-full-organization${query}`, ownerCookie);
    expect(listed.status).toBe(404);
    expect(full.status).toBe(404);
    expect(listed.text + full.text).not.toContain(invitationId);
  });

  it("não aceita convite pela rota pública, nem com o e-mail convidado", async () => {
    invitedCookie = await signUp(invited);
    const accepted = await request("/organization/accept-invitation", invitedCookie, {
      invitationId,
    });
    expect(accepted.status).toBe(404);
  });

  it("a tela segue lendo os convites e o link segue funcionando no servidor", async () => {
    const headers = new Headers({ cookie: ownerCookie });
    const pending = await getAuth().api.listInvitations({
      headers,
      query: { organizationId },
    });
    expect(pending.map((item) => item.id)).toContain(invitationId);
    const accepted = await getAuth().api.acceptInvitation({
      headers: new Headers({ cookie: invitedCookie }),
      body: { invitationId },
    });
    expect(accepted?.member.role).toBe("adult");
  });
});
