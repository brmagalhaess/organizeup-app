// Web nova com o worker atrasado (ADR-0023): banco ainda na 0035, como ou_app, com a chave desligada. O
// primeiro commit vai a produção antes do resto, mas nada garante quem sobe primeiro. Só a sessão é
// simulada. Dados fictícios.
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { defaultMigrationsDir } from "@organizeup/db/migrator";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";

// O driver é dependência só de packages/db: a web nunca fala com o Postgres por fora de lá.
const postgres = createRequire(
  path.resolve(import.meta.dirname, "../../../../../packages/db/package.json"),
)("postgres") as typeof import("../../../../../packages/db/node_modules/postgres");

const urls = inject("dbUrls");
const database = `ou_atraso_${Date.now()}`;
const inLate = (url: string) => {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
};

// As migrações rodam antes de importar o pacote do banco: os pools leem o ambiente uma vez.
const owner = postgres(urls.owner, { max: 1, onnotice: () => {} });
await owner.unsafe(`create database ${database}`);
const late = postgres(inLate(urls.owner), { max: 1, onnotice: () => {} });
{
  const dir = defaultMigrationsDir();
  const files = readdirSync(dir)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file) && file < "0036")
    .toSorted();
  for (const file of files) await late.unsafe(readFileSync(path.join(dir, file), "utf8"));
  await late.unsafe(`
    GRANT USAGE ON SCHEMA public, ops TO ou_app, ou_worker, ou_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ou_app, ou_worker, ou_admin;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ou_app, ou_worker, ou_admin;
    GRANT SELECT ON ALL TABLES IN SCHEMA ops TO ou_app, ou_worker, ou_admin;
    GRANT INSERT, UPDATE ON ops.ai_stats TO ou_app, ou_worker;
    GRANT ALL ON ALL TABLES IN SCHEMA ops TO ou_admin;
  `);
}

process.env.DATABASE_URL = inLate(urls.app);
process.env.ADMIN_DATABASE_URL = inLate(urls.admin);

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
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ has: () => false, set: () => undefined }),
}));
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
const ai = await import("@organizeup/ai");
const agents = await import("@organizeup/agents");
const { requireTenant } = await import("@/lib/session");
const { saveEntry, confirmEntryNotice } = await import("@/app/app/(painel)/lancamentos/actions");
const { commitImport, prepareImport } = await import("@/app/app/(painel)/importar/actions");
const { GET: exportData } = await import("@/app/app/exportar/route");
const { loadMonth, loadOverview } = await import("@/lib/finance-data");
const { loadTripIntentionItems } = await import("@/lib/suggestions");
const { fakeClient, textReply } = await import("../../../../../packages/ai/test/fake-client");
const { accounts, categories, creditCards, household, householdMember, householdSettings } = db;
const { cardPurchases, cashflowPlans, transactions, trips } = db;

const family = "hh-atraso";
const person = "user-atraso";
const today = domain.todayIn();
let ctx: Awaited<ReturnType<typeof requireTenant>>["ctx"];
let account = "";
let category = "";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const save = (over: Record<string, string> = {}) =>
  saveEntry(
    { ok: false, message: null },
    form({
      key: "",
      kind: "despesa",
      description: "Mercado",
      amount: "10,00",
      date: today,
      categoryId: category,
      accountId: account,
      done: "on",
      ...over,
    }),
  );

beforeAll(async () => {
  auth.userId = person;
  auth.householdId = family;
  // "user" ganhou a coluna two_factor_enabled na migration 0044: o Drizzle lista todas as colunas do
  // schema atual num insert, e este banco simulado só tem as migrations até a 0035. Insert cru.
  await late.unsafe(`insert into "user" (id, name, email) values ($1, $2, $3)`, [
    person,
    "T",
    "atraso@example.com",
  ]);
  await db.withAdmin("seed do teste de atraso", async (admin) => {
    await admin.insert(household).values({ id: family, name: "Família", slug: family });
    await admin
      .insert(householdMember)
      .values({ id: "m-atraso", organizationId: family, userId: person, role: "owner" });
  });
  ({ ctx } = await requireTenant());
  await db.withHousehold(ctx, async (tx) => {
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
  });
});

afterAll(async () => {
  await db.closeAllPools();
  await late.end();
  await owner.unsafe(`drop database ${database} with (force)`);
  await owner.end();
});

describe("web nova em banco na 0035", () => {
  it("o banco está mesmo atrasado", async () => {
    await expect(late`select usage_month from transactions limit 1`).rejects.toThrow();
    await expect(late`select 1 from household_usage`).rejects.toThrow();
  });

  it("sessão, plano e leitura seguem como hoje", async () => {
    const { ctx: tenant, role } = await requireTenant();
    expect(role).toBe("owner");
    expect(db.canWrite(tenant)).toBe(true);
    expect((await db.readFamilyAccess(tenant)).mode).toBe("livre");
    expect(await db.readBillingCatalog()).toEqual([]);
    expect(await db.readSubscription(tenant)).toBeNull();
    expect(await db.readMonthUsage(tenant)).toBeNull();
  });

  it("listar lançamentos e abrir o painel não caem", async () => {
    await expect(loadMonth(ctx)).resolves.toBeTruthy();
    await expect(loadOverview(ctx)).resolves.toBeTruthy();
    await expect(
      db.withHousehold(ctx, (tx) => tx.select().from(transactions).limit(1)),
    ).resolves.toEqual([]);
    await expect(
      db.withHousehold(ctx, (tx) => tx.select().from(cardPurchases).limit(1)),
    ).resolves.toEqual([]);
  });

  it("lançar, comprar no cartão e repetir gravam", async () => {
    expect((await save()).ok).toBe(true);
    expect((await save({ repeat: "on", description: "Aluguel" })).ok).toBe(true);
    const [card] = await db.withHousehold(ctx, (tx) =>
      tx
        .insert(creditCards)
        .values({
          householdId: family,
          name: "Cartão",
          closingDay: 1,
          dueDay: 10,
          payingAccountId: account,
        })
        .returning({ id: creditCards.id }),
    );
    expect((await save({ accountId: `card:${card!.id}`, description: "Compra" })).ok).toBe(true);
  });

  it("marcar como pago e importar gravam", async () => {
    const [plan] = await db.withHousehold(ctx, (tx) =>
      tx.select({ id: cashflowPlans.id }).from(cashflowPlans).limit(1),
    );
    const month = domain.yearMonthOf(today);
    await db.withHousehold(ctx, (tx) => tx.delete(transactions));
    expect(await confirmEntryNotice(form({ key: `p:${plan!.id}`, month }))).toBeNull();

    const rows = [
      { date: today, description: "Padaria", amount: "12.34", kind: "despesa" as const },
    ];
    const prepared = await prepareImport({ accountId: account, source: "csv", rows });
    expect(prepared).toMatchObject({ ok: true, room: null });
    if (!prepared.ok) return;
    const result = await commitImport({
      accountId: account,
      source: "csv",
      rows: prepared.rows.map((row) => ({
        date: row.date,
        description: row.description,
        amount: row.amount,
        kind: row.kind,
        fingerprint: row.fingerprint,
        categoryId: category,
        newCategory: null,
        source: "revisar" as const,
        corrected: false,
        matchKey: null,
        matchMonth: null,
      })),
    });
    expect(result).toMatchObject({ ok: true, imported: 1 });
  });

  it("exportar funciona, com as tabelas novas vazias", async () => {
    const response = await exportData();
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()) as {
      tables: { transactions: unknown[]; household_subscriptions: unknown[] };
    };
    expect(body.tables.transactions.length).toBeGreaterThan(0);
    expect(body.tables.household_subscriptions).toEqual([]);
  });

  it("Viagens segue sem o bloco de intenções, e o agente segue sem elas", async () => {
    expect(await loadTripIntentionItems(ctx)).toBeNull();
    const body = JSON.parse(await (await exportData()).text()) as {
      tables: { trip_intentions: unknown[] };
    };
    expect(body.tables.trip_intentions).toEqual([]);
    // O savepoint segura o erro: a transação continua viva para o resto da rodada.
    await db.withHousehold(ctx, async (tx) => {
      expect(await agents.loadTripIntentions(tx)).toEqual([]);
      expect(await tx.select().from(trips)).toEqual([]);
    });
  });

  it("aceitar uma sugestão genérica de viagem funciona sem a tabela de intenções", async () => {
    const [created] = await db.withHousehold(ctx, async (tx) => {
      const [titular] = await tx
        .insert(db.people)
        .values({ householdId: family, name: "Titular", relation: "titular", userId: person })
        .returning({ id: db.people.id });
      return tx
        .insert(db.householdSuggestions)
        .values({
          householdId: family,
          agent: "viagens",
          kind: "viagem",
          title: "Viagem",
          body: "Sugestão",
          dedupeKey: "viagem:lisboa:2027",
          payload: {
            destinationId: "lisboa",
            name: "Lisboa",
            month: "2027-05",
            days: 5,
            personIds: [titular!.id],
            estimated: {
              passagem: "1000.00",
              hospedagem: "1000.00",
              alimentacao: "500.00",
              transporte: "100.00",
            },
            total: "2600.00",
            monthlyToSave: "400.00",
            fits: true,
            confidence: "media",
            source: "tabela",
          },
        })
        .returning({ id: db.householdSuggestions.id });
    });
    const applied = await db.withHousehold(ctx, (tx) =>
      agents.applySuggestion(tx, ctx, created!.id),
    );
    expect(applied).toMatchObject({ ok: true, code: "tripCreated" });
  });

  it("conversar com o assistente funciona, sem contar mensagem", async () => {
    process.env.ANTHROPIC_API_KEY = "chave-de-teste";
    await ai.activateAssistant(ctx, {
      autonomy: "organizar",
      version: ai.INSIGHTS_CONSENT_VERSION,
    });
    const events: unknown[] = [];
    await ai.runChatTurn({
      ctx,
      client: fakeClient([textReply("Oi.")]).client,
      message: "Quanto gastei?",
      limits: { monthlyBudgetUsd: 1000, familyDailyTokens: 1_000_000 },
      day: today,
      emit: (event) => events.push(event),
    });
    expect(events.at(-1)).toMatchObject({ type: "done", status: "completa" });
  });
});
