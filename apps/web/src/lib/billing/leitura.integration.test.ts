// Fim do teste sem assinatura, pela `requireTenant` de verdade (ADR-0023): só leitura, exportar continua e
// nada é apagado. Só a sessão do Better Auth é simulada. Dados fictícios.
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.worker;
process.env.ADMIN_DATABASE_URL = urls.admin;

const auth = vi.hoisted(() => ({ userId: "", householdId: "" }));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: {
      getSession: async () => ({
        user: { id: auth.userId, email: "dono@example.com" },
        session: { activeOrganizationId: auth.householdId },
      }),
    },
  }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("404");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { messagesFor } = await import("@/i18n/messages");
  const messages = messagesFor("pt-BR");
  return {
    getLocale: async () => "pt-BR",
    getMessages: async () => messages,
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "pt-BR", messages, namespace } as never),
  };
});

const db = await import("@organizeup/db");
const domain = await import("@organizeup/domain");
const { requireTenant } = await import("@/lib/session");
const { requireModule } = await import("@/lib/billing/plan-gate");
const { saveEntry } = await import("@/app/app/(painel)/lancamentos/actions");
const { saveAccount } = await import("@/app/app/(painel)/contas/actions");
const { GET: exportData } = await import("@/app/app/exportar/route");
const { removeAllMemories } = await import("@/app/app/(painel)/configuracoes/actions");
const { deactivate } = await import("@/components/assistant/actions");
const ai = await import("@organizeup/ai");

const { accounts, categories, eq, featureFlags, household, householdMember } = db;
const { householdSettings, householdSubscriptions, transactions, user } = db;

const today = domain.todayIn();
let family = "";
let account = "";
let category = "";
let count = 0;

const setBilling = (enabled: boolean) =>
  db.withAdmin("teste de só leitura: chave", (admin) =>
    admin.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, db.FLAG_KEYS.billing)),
  );

async function expire() {
  await db.withWorkerHousehold(family, (tx) =>
    tx
      .update(householdSubscriptions)
      .set({ courtesy: false, trialEndsAt: new Date(Date.now() - 1000) })
      .where(eq(householdSubscriptions.householdId, family)),
  );
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const entry = () =>
  saveEntry(
    { ok: false, message: null },
    form({
      key: "",
      kind: "despesa",
      description: "Depois do teste",
      amount: "10,00",
      date: today,
      categoryId: category,
      accountId: account,
      done: "on",
    }),
  );

beforeAll(() => setBilling(true));
afterAll(() => setBilling(false));

beforeEach(async () => {
  count += 1;
  family = `hh-leitura-${count}`;
  const owner = `user-leitura-${count}`;
  auth.userId = owner;
  auth.householdId = family;
  await db.withAdmin("seed do teste de só leitura", async (admin) => {
    await admin.insert(user).values({ id: owner, name: "Teste", email: `${owner}@example.com` });
    await admin.insert(household).values({ id: family, name: "Família", slug: family });
    await admin
      .insert(householdMember)
      .values({ id: `m-${family}`, organizationId: family, userId: owner, role: "owner" });
  });
  const ctx = await db.fromSession({
    user: { id: owner },
    session: { activeOrganizationId: family },
  });
  await db.withHousehold(ctx!, async (tx) => {
    await tx.insert(householdSettings).values({ householdId: family });
    const [created] = await tx
      .insert(accounts)
      .values({ householdId: family, name: "Conta", type: "corrente" })
      .returning({ id: accounts.id });
    const [kind] = await tx
      .insert(categories)
      .values({ householdId: family, name: "Mercado", kind: "despesa" })
      .returning({ id: categories.id });
    account = created!.id;
    category = kind!.id;
    await tx.insert(transactions).values({
      householdId: family,
      accountId: account,
      categoryId: category,
      kind: "despesa",
      description: "Antes do fim do teste",
      amount: "42.00",
      occurredOn: today,
    });
  });
});

describe("no teste", () => {
  it("grava normalmente", async () => {
    await db.withWorkerHousehold(family, (tx) =>
      tx
        .update(householdSubscriptions)
        .set({ courtesy: false, trialEndsAt: new Date(Date.now() + 86_400_000) })
        .where(eq(householdSubscriptions.householdId, family)),
    );
    const { ctx } = await requireTenant();
    expect(db.canWrite(ctx)).toBe(true);
    expect((await entry()).ok).toBe(true);
  });
});

describe("fim do teste sem assinatura", () => {
  it("o contexto vem só leitura, e o papel de verdade segue o de responsável", async () => {
    await expire();
    const { ctx, role } = await requireTenant();
    expect(ctx.role).toBe("viewer");
    expect(role).toBe("owner");
    expect(db.canWrite(ctx)).toBe(false);
  });

  it("nada é gravado: lançar e criar conta recusam", async () => {
    await expire();
    expect((await entry()).ok).toBe(false);
    const created = await saveAccount(
      { ok: false, message: null },
      form({ id: "", name: "Nova", type: "corrente", currency: "BRL", openingBalance: "" }),
    );
    expect(created.ok).toBe(false);
  });

  it("nem a RLS deixa: gravar direto com o contexto só leitura falha", async () => {
    await expire();
    const { ctx } = await requireTenant();
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.insert(transactions).values({
          householdId: family,
          accountId: account,
          categoryId: category,
          kind: "despesa",
          description: "Escapou",
          amount: "1.00",
          occurredOn: today,
        }),
      ),
    ).rejects.toThrow();
  });

  it("o que existe continua lá, e toda tela de módulo abre para consulta", async () => {
    await expire();
    const { ctx } = await requireTenant();
    const rows = await db.withHousehold(ctx, (tx) => tx.select().from(transactions));
    expect(rows.map((row) => row.description)).toEqual(["Antes do fim do teste"]);
    for (const name of domain.BILLING_MODULES) {
      const gate = await requireModule(name);
      expect(gate.allowed, name).toBe(true);
      expect(db.canWrite(gate.ctx), name).toBe(false);
    }
  });

  it("exportar continua, com os dados da família", async () => {
    await expire();
    const response = await exportData();
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()) as {
      tables: { transactions: Array<{ description: string }> };
    };
    expect(body.tables.transactions.map((row) => row.description)).toEqual([
      "Antes do fim do teste",
    ]);
  });

  it("a exportação sai igual, com a auditoria, e fica registrada", async () => {
    const { ctx } = await requireTenant();
    await db.withHousehold(ctx, (tx) =>
      tx.insert(db.auditLog).values({
        householdId: family,
        actorKind: "user",
        action: "update",
        entity: "household",
      }),
    );
    await expire();
    const body = JSON.parse(await (await exportData()).text()) as {
      tables: { audit_log: Array<{ action: string }>; household_subscriptions: unknown[] };
    };
    expect(body.tables.audit_log.map((row) => row.action)).toContain("update");
    expect(body.tables.household_subscriptions).toHaveLength(1);
    const owner = await db.fromSession({
      user: { id: auth.userId },
      session: { activeOrganizationId: family },
    });
    const rows = await db.withHousehold(owner!, (tx) => tx.select().from(db.auditLog));
    expect(rows.map((row) => row.action)).toContain("export");
  });

  it("apagar memória e desligar o assistente continuam possíveis", async () => {
    const owner = await db.fromSession({
      user: { id: auth.userId },
      session: { activeOrganizationId: family },
    });
    await ai.activateAssistant(owner!, { autonomy: "organizar", version: "2026-11-01" });
    await db.withHousehold(owner!, (tx) =>
      tx.insert(db.householdMemories).values({
        householdId: family,
        kind: "fato",
        content: "Gosta de planilhas",
        searchKey: "planilhas",
      } as never),
    );
    await expire();
    expect((await removeAllMemories()).ok).toBe(true);
    expect(await ai.listMemories(owner!)).toEqual([]);
    await deactivate();
    expect((await ai.readAssistantSettings(owner!))?.consentAt).toBeNull();
  });

  it("assinar depois volta a gravar, sem nada perdido", async () => {
    await expire();
    expect((await entry()).ok).toBe(false);
    await db.withWorkerHousehold(family, (tx) =>
      tx
        .update(householdSubscriptions)
        .set({
          status: "active",
          cycle: "mes",
          items: [{ price: "price_f", item: "familia", amount: "44.90", quantity: 1 }],
        })
        .where(eq(householdSubscriptions.householdId, family)),
    );
    expect((await entry()).ok).toBe(true);
  });
});

describe("manutenção", () => {
  const maintenance = (enabled: boolean) =>
    db.withAdmin("teste de só leitura: manutenção", (admin) =>
      admin
        .insert(featureFlags)
        .values({ key: db.FLAG_KEYS.maintenance, enabled })
        .onConflictDoUpdate({ target: featureFlags.key, set: { enabled } }),
    );

  it("com a chave desligada, exportar se comporta como antes: recusa", async () => {
    await setBilling(false);
    await maintenance(true);
    try {
      expect((await exportData()).status).toBe(403);
      expect((await requireTenant()).role).toBe("viewer");
    } finally {
      await maintenance(false);
      await setBilling(true);
    }
  });
});

describe("com a chave desligada", () => {
  it("teste vencido não muda nada: todos como hoje", async () => {
    await expire();
    await setBilling(false);
    try {
      const { ctx } = await requireTenant();
      expect(db.canWrite(ctx)).toBe(true);
      expect((await entry()).ok).toBe(true);
    } finally {
      await setBilling(true);
    }
  });
});
