// Plano na web, pelas server actions de verdade, contra um Postgres real com RLS e como ou_app, a conexão
// da web em produção. Sessão e cache do Next.js simulados; a Stripe é o cliente falso abaixo, e nada aqui
// chama a API. O que só o worker e o painel gravam vai por ou_admin. Dados fictícios.
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";
import type { TenantContext } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;
process.env.BETTER_AUTH_URL = "https://app.example.com";

const session = vi.hoisted(() => ({
  ctx: null as unknown,
  user: { id: "", email: "dono@example.com" },
  admin: false,
}));
const gateway = vi.hoisted(() => ({
  createCustomer: vi.fn(async () => "cus_web_novo"),
  hasLiveSubscription: vi.fn(async () => false),
  expireCheckout: vi.fn(async () => false),
  createCheckout: vi.fn(async () => ({
    id: `cs_web${Math.random().toString(36).slice(2, 10)}`,
    url: "https://checkout.example.com/sessao",
  })),
  cancelNow: vi.fn(async () => undefined),
  previewChange: vi.fn(async () => ({ dueNow: "3.20", prorationDate: 1_790_000_000 })),
  applyChange: vi.fn(async () => undefined),
  setCancelAtPeriodEnd: vi.fn(async () => undefined),
  refundAndCancel: vi.fn(async () => "devolvido"),
  portalUrl: vi.fn(async () => "https://billing.example.com/portal"),
}));
vi.mock("@/lib/billing/gateway", () => ({ billingGateway: () => gateway }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("404");
  },
}));
vi.mock("@/lib/session", async () => {
  const { readPlatformFlags } = await import("@organizeup/db");
  return {
    requireTenant: async () => ({ ctx: session.ctx, role: "owner" }),
    requireSession: async () => ({
      user: session.user,
      session: { activeOrganizationId: (session.ctx as TenantContext).householdId },
    }),
    requireAdmin: async () => ({ user: { id: "admin-teste", email: "admin@example.com" } }),
    isServiceAdmin: () => session.admin,
    platformFlags: readPlatformFlags,
  };
});
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
const { confirmEntry, confirmEntryNotice, deleteEntry, saveEntry } =
  await import("@/app/app/(painel)/lancamentos/actions");
const { commitImport, prepareImport, undoImport } =
  await import("@/app/app/(painel)/importar/actions");
const { createTransfer, saveAccount } = await import("@/app/app/(painel)/contas/actions");
const { saveGoal } = await import("@/app/app/(painel)/metas/actions");
const { deleteFamily } = await import("@/app/admin/familias/actions");
const { deleteUser } = await import("@/app/admin/usuarios/actions");
const { closeOwnHouseholds } = await import("@/lib/auth");
const { finishOnboarding, saveRetirementStep } =
  await import("@/app/app/(inicio)/completar/actions");
const { applySuggestion, dismissSuggestion, undoSuggestion } =
  await import("@/app/app/(painel)/sugestoes/actions");
const actions = await import("@/app/app/(painel)/assinatura/actions");

const { accounts, billingCatalog, cashflowPlans, categories, creditCards } = db;
const { eq, featureFlags, goals, household, householdMember, householdSettings } = db;
const { householdSubscriptions, householdSuggestions, importBatches, transactions, user } = db;

const today = domain.todayIn();
const month = domain.yearMonthOf(today);

interface Family {
  id: string;
  owner: string;
  ctx: TenantContext;
  account: string;
  category: string;
  income: string;
}

let family: Family;
let families = 0;

const inFamily = <T>(fn: Parameters<typeof db.withHousehold<T>>[1]) =>
  db.withHousehold(family.ctx, fn);

/** O plano só o worker e o painel gravam: nem aqui a web escreve nele. */
const setSub = (values: Partial<typeof householdSubscriptions.$inferInsert>) =>
  db.withAdmin("teste de planos: assinatura", (admin) =>
    admin
      .update(householdSubscriptions)
      .set(values)
      .where(eq(householdSubscriptions.householdId, family.id)),
  );

/** Lançamentos já feitos no mês, marcados como `saveEntry` marca. */
const seedEntries = (count: number) =>
  inFamily(async (tx) => {
    const rows = await tx
      .insert(transactions)
      .values(
        Array.from({ length: count }, (_, index) => ({
          householdId: family.id,
          accountId: family.account,
          categoryId: family.category,
          kind: "despesa" as const,
          description: `Antigo ${index}`,
          amount: "1.00",
          occurredOn: today,
        })),
      )
      .returning({ id: transactions.id });
    await db.markEntries(
      tx,
      month,
      rows.map((row) => row.id),
    );
  });

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const items = (names: string[], cycle: "mes" | "ano" = "mes") =>
  names.map((item) => ({ price: `price_${item}_${cycle}`, item, amount: "9.90", quantity: 1 }));

async function subscribeFamily(names: string[], over: Record<string, unknown> = {}) {
  const cycle = (over.cycle as "mes" | "ano" | undefined) ?? "mes";
  await setSub({
    courtesy: false,
    trialEndsAt: null,
    status: "active",
    cycle,
    items: items(names, cycle),
    stripeCustomerId: `cus_web${families}`,
    stripeSubscriptionId: `sub_web${families}`,
    currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    ...over,
  });
}

async function newFamily(): Promise<Family> {
  families += 1;
  const id = `hh-web-plano-${families}`;
  const owner = `user-web-plano-${families}`;
  await db.withAdmin("seed do teste de planos", async (admin) => {
    await admin.insert(user).values({ id: owner, name: "Teste", email: `${owner}@example.com` });
    await admin.insert(household).values({ id, name: "Família", slug: id });
    await admin
      .insert(householdMember)
      .values({ id: `m-${id}`, organizationId: id, userId: owner, role: "owner" });
  });
  const ctx = await db.fromSession({ user: { id: owner }, session: { activeOrganizationId: id } });
  if (!ctx) throw new Error("sem contexto");
  const ids = await db.withHousehold(ctx, async (tx) => {
    await tx.insert(householdSettings).values({ householdId: id });
    const [account] = await tx
      .insert(accounts)
      .values({ householdId: id, name: "Conta", type: "corrente" })
      .returning({ id: accounts.id });
    const [category] = await tx
      .insert(categories)
      .values({ householdId: id, name: "Mercado", kind: "despesa" })
      .returning({ id: categories.id });
    const [income] = await tx
      .insert(categories)
      .values({ householdId: id, name: "Salário", kind: "receita" })
      .returning({ id: categories.id });
    return { account: account!.id, category: category!.id, income: income!.id };
  });
  session.ctx = ctx;
  session.user = { id: owner, email: `${owner}@example.com` };
  return { id, owner, ctx, ...ids };
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
      categoryId: family.category,
      accountId: family.account,
      done: "on",
      ...over,
    }),
  );

const counted = () => inFamily((tx) => db.countEntries(tx, month));

const statement = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    date: today,
    description: `Compra ${index}`,
    amount: "12.34",
    kind: "despesa" as const,
  }));

async function importRows(count: number) {
  const prepared = await prepareImport({
    accountId: family.account,
    source: "csv",
    rows: statement(count),
  });
  if (!prepared.ok) throw new Error(prepared.message);
  const result = await commitImport({
    accountId: family.account,
    source: "csv",
    rows: prepared.rows.map((row) => ({
      date: row.date,
      description: row.description,
      amount: row.amount,
      kind: row.kind,
      fingerprint: row.fingerprint,
      categoryId: family.category,
      newCategory: null,
      source: "revisar" as const,
      corrected: false,
      matchKey: null,
      matchMonth: null,
    })),
  });
  return { prepared, result };
}

const setBilling = (enabled: boolean) =>
  db.withAdmin("teste de planos: chave", (admin) =>
    admin.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, db.FLAG_KEYS.billing)),
  );

beforeAll(async () => {
  await db.withAdmin("seed do teste de planos", async (admin) => {
    const rows = await admin.select().from(billingCatalog);
    for (const row of rows) {
      await admin
        .update(billingCatalog)
        .set({ stripePriceId: `price_${row.item.replace(":", "_")}_${row.cycle}` })
        .where(eq(billingCatalog.id, row.id));
    }
  });
});

beforeEach(async () => {
  vi.clearAllMocks();
  await setBilling(true);
  family = await newFamily();
  session.admin = false;
  vi.stubEnv("STRIPE_SECRET_KEY", `sk_test_${"x".repeat(24)}`);
  vi.stubEnv("STRIPE_ALLOW_LIVE", "");
});

afterEach(() => vi.unstubAllEnvs());
afterAll(() => setBilling(false));

describe("limite de lançamentos", () => {
  it("no limite recusa o novo e deixa o resto como estava; apagar devolve a vaga", async () => {
    await subscribeFamily(["base:50"]);
    for (let index = 0; index < 50; index += 1) await save({ description: `Item ${index}` });
    expect(await counted()).toBe(50);

    const refused = await save({ description: "Passou" });
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("limite de lançamentos");

    const [row] = await inFamily((tx) =>
      tx.select().from(transactions).where(eq(transactions.description, "Item 0")),
    );
    const edited = await save({ key: `t:${row!.id}`, description: "Item 0 editado" });
    expect(edited.ok).toBe(true);
    expect(await counted()).toBe(50);

    await deleteEntry(form({ id: row!.id }));
    expect((await save({ description: "Coube" })).ok).toBe(true);
  });

  it("aviso e leitura seguem iguais depois do limite: nada some", async () => {
    await subscribeFamily(["base:50"]);
    await seedEntries(60);
    const rows = await inFamily((tx) => tx.select().from(transactions));
    expect(rows).toHaveLength(60);
    expect((await save()).ok).toBe(false);
    expect(domain.usageLevel(40, 50)).toBe("aviso");
  });

  it("recorrência não conta; compra parcelada conta uma vez", async () => {
    await subscribeFamily(["base:50"]);
    const plan = await save({ repeat: "on", description: "Aluguel", done: "" });
    expect(plan.ok).toBe(true);
    expect(await counted()).toBe(0);

    const [card] = await inFamily((tx) =>
      tx
        .insert(creditCards)
        .values({
          householdId: family.id,
          name: "Cartão",
          closingDay: 1,
          dueDay: 10,
          payingAccountId: family.account,
        })
        .returning({ id: creditCards.id }),
    );
    const saved = await save({
      accountId: `card:${card!.id}`,
      description: "Geladeira",
      installments: "12",
    });
    expect(saved.ok).toBe(true);
    expect(await counted()).toBe(1);
  });

  it("marcar como pago o que se repete não conta", async () => {
    await subscribeFamily(["base:50"]);
    const [plan] = await inFamily((tx) =>
      tx
        .insert(cashflowPlans)
        .values({
          householdId: family.id,
          accountId: family.account,
          categoryId: family.category,
          kind: "despesa",
          description: "Internet",
          amount: "100.00",
          dayOfMonth: 5,
          startMonth: month,
        })
        .returning({ id: cashflowPlans.id }),
    );
    await confirmEntry(form({ key: `p:${plan!.id}`, month }));
    const rows = await inFamily((tx) => tx.select().from(transactions));
    expect(rows).toHaveLength(1);
    expect(await counted()).toBe(0);
  });

  it("duas gravações ao mesmo tempo na última vaga: só uma passa", async () => {
    await subscribeFamily(["base:50"]);
    await seedEntries(49);
    const replies = await Promise.all(
      [1, 2, 3, 4].map((index) => save({ description: `Corrida ${index}` })),
    );
    expect(replies.filter((reply) => reply.ok)).toHaveLength(1);
    expect(await counted()).toBe(50);
  });

  it("sem limite, ou com a chave desligada, nada recusa", async () => {
    await subscribeFamily(["familia"]);
    expect((await save()).ok).toBe(true);
    await subscribeFamily(["base:50"]);
    await setBilling(false);
    for (let index = 0; index < 3; index += 1) expect((await save()).ok).toBe(true);
  });
});

describe("importação no limite", () => {
  it("mostra quantas linhas cabem antes de gravar", async () => {
    await subscribeFamily(["base:50"]);
    await importRows(10);
    const prepared = await prepareImport({
      accountId: family.account,
      source: "csv",
      rows: statement(5),
    });
    expect(prepared).toMatchObject({ ok: true, room: 40 });
    await subscribeFamily(["familia"]);
    const open = await prepareImport({
      accountId: family.account,
      source: "csv",
      rows: statement(5),
    });
    expect(open).toMatchObject({ ok: true, room: null });
  });

  it("acima do limite não grava nada: nem linha, nem lote, nem categoria", async () => {
    await subscribeFamily(["base:50"]);
    const before = await inFamily((tx) => tx.select().from(categories));
    const { prepared, result } = await importRows(51);
    expect(prepared.room).toBe(50);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain("Só cabem 50 linhas");
    expect(await inFamily((tx) => tx.select().from(transactions))).toEqual([]);
    expect(await inFamily((tx) => tx.select().from(importBatches))).toEqual([]);
    expect(await inFamily((tx) => tx.select().from(categories))).toHaveLength(before.length);
  });

  it("no limite exato passa, e desfazer a importação devolve as vagas", async () => {
    await subscribeFamily(["base:50"]);
    const { result } = await importRows(50);
    expect(result).toMatchObject({ ok: true, imported: 50 });
    expect(await counted()).toBe(50);
    const [batch] = await inFamily((tx) => tx.select().from(importBatches));
    await undoImport(form({ id: batch!.id }));
    expect(await counted()).toBe(0);
  });

  it("reenviar o mesmo arquivo não gasta vaga de novo", async () => {
    await subscribeFamily(["base:50"]);
    await importRows(30);
    const again = await commitImport({
      accountId: family.account,
      source: "csv",
      rows: domain.withFingerprints(statement(30), "csv").map((row) => ({
        ...row,
        categoryId: family.category,
        newCategory: null,
        source: "revisar" as const,
        corrected: false,
        matchKey: null,
        matchMonth: null,
      })),
    });
    expect(again).toMatchObject({ ok: true, imported: 0 });
    expect(await counted()).toBe(30);
  });

  it("duas importações juntas que só cabem uma: a outra não fica pela metade", async () => {
    await subscribeFamily(["base:50"]);
    const payload = (prefix: string) => ({
      accountId: family.account,
      source: "csv" as const,
      rows: domain
        .withFingerprints(
          statement(30).map((row) => ({ ...row, description: `${prefix} ${row.description}` })),
          "csv",
        )
        .map((row) => ({
          ...row,
          categoryId: family.category,
          newCategory: null,
          source: "revisar" as const,
          corrected: false,
          matchKey: null,
          matchMonth: null,
        })),
    });
    const [first, second] = await Promise.all([
      commitImport(payload("A")),
      commitImport(payload("B")),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(await counted()).toBe(30);
    expect(await inFamily((tx) => tx.select().from(importBatches))).toHaveLength(1);
  });
});

describe("módulo desligado", () => {
  const goal = () =>
    saveGoal(
      { ok: false, message: null },
      form({
        id: "",
        name: "Carro",
        kind: "veiculo",
        amount: "10.000,00",
        targetMonth: "2030-01",
        priority: "3",
        savingDay: "5",
        accountId: family.account,
      }),
    );

  it("action de módulo não grava; com o módulo, a mesma chamada segue", async () => {
    await subscribeFamily(["base:50"]);
    const refused = await goal();
    expect(refused.ok).toBe(false);
    expect(await inFamily((tx) => tx.select().from(goals))).toEqual([]);
  });

  it("sugestão de módulo desligado não aplica, mas dá para dispensar", async () => {
    await subscribeFamily(["base:50"]);
    const [row] = await inFamily((tx) =>
      tx
        .insert(householdSuggestions)
        .values({
          householdId: family.id,
          agent: "metas",
          kind: "meta",
          title: "Meta",
          body: "Texto",
          dedupeKey: "meta:teste",
          payload: {},
        })
        .returning({ id: householdSuggestions.id }),
    );
    const applied = await applySuggestion(form({ id: row!.id }));
    expect(applied.ok).toBe(false);
    const [still] = await inFamily((tx) => tx.select().from(householdSuggestions));
    expect(still?.status).toBe("pendente");
    expect((await dismissSuggestion(form({ id: row!.id }))).ok).toBe(true);
  });
});

describe("moeda adicional", () => {
  const account = (currency: string) =>
    saveAccount(
      { ok: false, message: null },
      form({ id: "", name: `Conta ${currency}`, type: "corrente", currency, openingBalance: "" }),
    );

  it("só libera criar conta na moeda assinada; a principal é grátis", async () => {
    await subscribeFamily(["base:50", "moeda:USD"]);
    expect((await account("BRL")).ok).toBe(true);
    expect((await account("USD")).ok).toBe(true);
    const refused = await account("EUR");
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("EUR");
  });

  it("cancelada, a conta fica só leitura: nada novo entra, e o histórico continua", async () => {
    await subscribeFamily(["base:50", "moeda:USD"]);
    await account("USD");
    const [dollars] = await inFamily((tx) =>
      tx.select().from(accounts).where(eq(accounts.currency, "USD")),
    );
    // Direto no banco: cotação é global, e outros arquivos de teste contam com a falta dela.
    await inFamily((tx) =>
      tx.insert(transactions).values({
        householdId: family.id,
        accountId: dollars!.id,
        categoryId: family.category,
        kind: "despesa",
        description: "Antes",
        amount: "50.00",
        originalAmount: "10.00",
        originalCurrency: "USD",
        fxRate: "5.00000000",
        occurredOn: today,
      }),
    );

    await subscribeFamily(["base:50"]);
    const refused = await save({ accountId: dollars!.id, description: "Depois" });
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("USD");
    const transfer = await createTransfer(
      { ok: false, message: null },
      form({
        fromAccountId: family.account,
        toAccountId: dollars!.id,
        amount: "10,00",
        toAmount: "2,00",
        occurredOn: today,
        note: "",
      }),
    );
    expect(transfer.ok).toBe(false);
    const prepared = await prepareImport({
      accountId: dollars!.id,
      source: "csv",
      rows: statement(1),
    });
    expect(prepared.ok).toBe(false);

    const rows = await inFamily((tx) =>
      tx.select().from(transactions).where(eq(transactions.accountId, dollars!.id)),
    );
    expect(rows.map((row) => row.description)).toEqual(["Antes"]);
    expect((await save({ description: "Na conta em real" })).ok).toBe(true);
  });
});

describe("assinar", () => {
  const FAMILY = domain.FAMILY_SELECTION;

  it("abre o pagamento com os preços do catálogo, e a Stripe só recebe o id da família", async () => {
    const reply = await actions.subscribe(FAMILY);
    expect(reply).toEqual({ ok: true, url: "https://checkout.example.com/sessao" });
    expect(gateway.createCheckout).toHaveBeenCalledWith({
      householdId: family.id,
      customerId: "cus_web_novo",
      prices: [{ price: "price_familia_mes", quantity: 1 }],
      cycle: "mes",
      locale: "pt-BR",
      successUrl: "https://app.example.com/app/assinatura?assinou=1",
      cancelUrl: "https://app.example.com/app/assinatura",
    });
    expect(JSON.stringify(gateway.createCheckout.mock.calls)).not.toContain("@example.com");
  });

  it("o total da tela é o que vai para a Stripe", async () => {
    const selection = {
      ...FAMILY,
      family: false,
      entries: "200" as const,
      modules: ["dividas" as const, "metas" as const],
      messages: 30 as const,
      currencies: ["USD" as const],
      cycle: "ano" as const,
    };
    await actions.subscribe(selection);
    const catalog = await db.readBillingCatalog();
    const quote = domain.quotePlan(selection, catalog);
    const call = gateway.createCheckout.mock.calls[0] as unknown as [
      { prices: Array<{ price: string }> },
    ];
    expect(call[0].prices.map((line) => line.price)).toEqual(
      quote.lines.map((line) => line.stripePriceId),
    );
    expect(quote.total).toBe("465.00");
  });

  it("moeda principal nunca vira cobrança", async () => {
    await actions.subscribe({ ...FAMILY, currencies: ["BRL", "USD"] });
    const call = gateway.createCheckout.mock.calls[0] as unknown as [
      { prices: Array<{ price: string }> },
    ];
    expect(call[0].prices.map((line) => line.price)).toEqual([
      "price_familia_mes",
      "price_moeda_USD_mes",
    ]);
  });

  it("contas conectadas fora de venda não podem ser compradas", async () => {
    expect(await actions.subscribe({ ...FAMILY, connectedAccounts: 1 })).toEqual({
      ok: false,
      code: "catalogo",
    });
    expect(gateway.createCheckout).not.toHaveBeenCalled();
  });

  it("quando entrarem à venda, a Stripe recebe a quantidade", async () => {
    const onSale = (value: boolean) =>
      db.withAdmin("teste", (admin) =>
        admin
          .update(billingCatalog)
          .set({ onSale: value })
          .where(eq(billingCatalog.item, "contas_conectadas")),
      );
    await onSale(true);
    try {
      await actions.subscribe({ ...FAMILY, connectedAccounts: 3 });
      const call = gateway.createCheckout.mock.calls[0] as unknown as [{ prices: unknown[] }];
      expect(call[0].prices).toEqual([
        { price: "price_familia_mes", quantity: 1 },
        { price: "price_contas_conectadas_mes", quantity: 3 },
      ]);
    } finally {
      await onSale(false);
    }
  });

  it("escolha inválida nem chega à Stripe", async () => {
    expect(await actions.subscribe({ ...FAMILY, messages: 77 })).toEqual({
      ok: false,
      code: "invalido",
    });
    expect(gateway.createCheckout).not.toHaveBeenCalled();
  });

  it("preço ainda não criado na Stripe não abre pagamento", async () => {
    await db.withAdmin("teste", (admin) =>
      admin
        .update(billingCatalog)
        .set({ stripePriceId: null })
        .where(eq(billingCatalog.item, "familia")),
    );
    try {
      expect(await actions.subscribe(FAMILY)).toEqual({ ok: false, code: "catalogo" });
    } finally {
      await db.withAdmin("teste", async (admin) => {
        await admin
          .update(billingCatalog)
          .set({ stripePriceId: "price_familia_mes" })
          .where(db.and(eq(billingCatalog.item, "familia"), eq(billingCatalog.cycle, "mes")));
        await admin
          .update(billingCatalog)
          .set({ stripePriceId: "price_familia_ano" })
          .where(db.and(eq(billingCatalog.item, "familia"), eq(billingCatalog.cycle, "ano")));
      });
    }
  });

  it("chave desligada: só admin com chave de teste; nunca com chave de produção", async () => {
    await setBilling(false);
    expect(await actions.subscribe(FAMILY)).toEqual({ ok: false, code: "desligado" });

    session.admin = true;
    expect((await actions.subscribe(FAMILY)).ok).toBe(true);

    vi.stubEnv("STRIPE_SECRET_KEY", `sk_live_${"x".repeat(24)}`);
    expect(await actions.subscribe(FAMILY)).toEqual({ ok: false, code: "chave_producao" });
    expect(gateway.createCheckout).toHaveBeenCalledOnce();
  });

  it("chave ligada com chave de produção: recusa sem a variável do fundador", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", `rk_live_${"x".repeat(24)}`);
    expect(await actions.subscribe(FAMILY)).toEqual({ ok: false, code: "chave_producao" });
    vi.stubEnv("STRIPE_ALLOW_LIVE", "true");
    expect((await actions.subscribe(FAMILY)).ok).toBe(true);
  });

  it("sem chave da Stripe, diz que não está configurada", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(await actions.subscribe(FAMILY)).toEqual({ ok: false, code: "sem_chave" });
  });

  it("só o responsável assina", async () => {
    const adult = `user-adulto-${families}`;
    await db.withAdmin("teste", async (admin) => {
      await admin.insert(user).values({ id: adult, name: "A", email: `${adult}@example.com` });
      await admin
        .insert(householdMember)
        .values({ id: `m-${adult}`, organizationId: family.id, userId: adult, role: "adult" });
    });
    session.user = { id: adult, email: `${adult}@example.com` };
    expect(await actions.subscribe(FAMILY)).toEqual({ ok: false, code: "so_responsavel" });
  });

  it("erro da Stripe vira código, sem a mensagem dela", async () => {
    gateway.createCheckout.mockRejectedValueOnce(new Error("cartão de ana@example.com recusado"));
    expect(await actions.subscribe(FAMILY)).toEqual({ ok: false, code: "falhou" });
  });
});

describe("trocar", () => {
  const avulso = (over: Partial<import("@organizeup/domain").PlanSelection> = {}) => ({
    family: false,
    entries: "50" as const,
    modules: [] as import("@organizeup/domain").PaidModule[],
    messages: 0 as const,
    currencies: [] as import("@organizeup/domain").Currency[],
    connectedAccounts: 0,
    cycle: "mes" as const,
    ...over,
  });

  beforeEach(async () => {
    const prices = await db.readBillingCatalog();
    const stored = (names: string[]) =>
      names.map((item) => {
        const row = prices.find((price) => price.item === item && price.cycle === "mes")!;
        return { price: row.stripePriceId!, item, amount: row.amount, quantity: 1 };
      });
    await subscribeFamily(["base:50", "modulo:metas"], {
      items: stored(["base:50", "modulo:metas"]),
    });
  });

  it("upgrade: prévia com o valor de hoje, e aplicar leva a mesma data", async () => {
    const target = avulso({ modules: ["metas", "dividas"] });
    const reply = await actions.previewPlan(target);
    expect(reply).toMatchObject({
      ok: true,
      preview: {
        dueNow: "3.20",
        prorationDate: 1_790_000_000,
        laterAt: null,
        nextTotal: "24.70",
        added: ["modulo:dividas"],
        removed: [],
      },
    });
    expect(gateway.previewChange).toHaveBeenCalledWith(
      `sub_web${families}`,
      ["price_base_50_mes", "price_modulo_dividas_mes", "price_modulo_metas_mes"].map((price) => ({
        price,
        quantity: 1,
      })),
    );

    const now = Math.floor(Date.now() / 1000);
    expect(await actions.changePlan(target, now)).toEqual({ ok: true });
    expect(gateway.applyChange).toHaveBeenCalledWith(
      expect.objectContaining({ later: null, prorationDate: now }),
    );
  });

  it("prévia velha não fixa a data do que a Stripe cobra", async () => {
    await actions.changePlan(avulso({ entries: "200", modules: ["metas"] }), 1_000);
    expect(gateway.applyChange).toHaveBeenCalledWith(
      expect.objectContaining({ prorationDate: null }),
    );
  });

  it("downgrade: nada na hora, marcado para o fim do ciclo, e a tela diz o que sai", async () => {
    const reply = await actions.previewPlan(avulso());
    expect(reply).toMatchObject({
      ok: true,
      preview: { dueNow: null, removed: ["modulo:metas"], nextTotal: "9.90" },
    });
    expect(reply.ok && reply.preview.laterAt).toBeTruthy();
    expect(gateway.previewChange).not.toHaveBeenCalled();

    await actions.changePlan(avulso(), null);
    expect(gateway.applyChange).toHaveBeenCalledWith(
      expect.objectContaining({
        now: null,
        later: [{ price: "price_base_50_mes", quantity: 1 }],
      }),
    );
  });

  it("subir e descer juntos: o que sobe agora, o resto no fim do ciclo", async () => {
    await actions.changePlan(avulso({ modules: ["dividas"] }), null);
    const call = gateway.applyChange.mock.calls[0] as unknown as [
      { now: Array<{ price: string }>; later: Array<{ price: string }> },
    ];
    expect(call[0].now.map((line) => line.price).toSorted()).toEqual(
      ["price_base_50_mes", "price_modulo_dividas_mes", "price_modulo_metas_mes"].toSorted(),
    );
    expect(call[0].later.map((line) => line.price).toSorted()).toEqual(
      ["price_base_50_mes", "price_modulo_dividas_mes"].toSorted(),
    );
  });

  it("com redução marcada, trocar de novo leva o schedule para ser solto", async () => {
    await setSub({ stripeScheduleId: "sub_sched_web" });
    await actions.changePlan(avulso({ entries: "200", modules: ["metas"] }), null);
    expect(gateway.applyChange).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleId: "sub_sched_web" }),
    );
  });

  it("preço novo não muda quem já assina: item que fica leva o preço antigo", async () => {
    await setSub({
      items: [
        { price: "price_base_50_antigo", item: "base:50", amount: "5.00", quantity: 1 },
        { price: "price_modulo_metas_mes", item: "modulo:metas", amount: "6.90", quantity: 1 },
      ],
    });
    const reply = await actions.previewPlan(avulso({ modules: ["metas", "dividas"] }));
    expect(reply).toMatchObject({ preview: { nextTotal: "19.80" } });
    const call = gateway.previewChange.mock.calls[0] as unknown as [
      string,
      Array<{ price: string }>,
    ];
    expect(call[1].map((line) => line.price)).toContain("price_base_50_antigo");
  });

  it("nada grava no plano local: quem muda é o webhook", async () => {
    const before = await inFamily((tx) => tx.select().from(householdSubscriptions));
    await actions.changePlan(avulso({ modules: ["metas", "dividas"] }), null);
    await actions.cancelPlan();
    expect(await inFamily((tx) => tx.select().from(householdSubscriptions))).toEqual(before);
  });

  it("cancelar e voltar atrás", async () => {
    expect(await actions.cancelPlan()).toEqual({ ok: true });
    expect(gateway.setCancelAtPeriodEnd).toHaveBeenCalledWith({
      householdId: family.id,
      subscriptionId: `sub_web${families}`,
      scheduleId: null,
      cancel: true,
    });
    await actions.resumePlan();
    expect(gateway.setCancelAtPeriodEnd).toHaveBeenLastCalledWith({
      householdId: family.id,
      subscriptionId: `sub_web${families}`,
      scheduleId: null,
      cancel: false,
    });
  });

  it("sem assinatura não há o que trocar", async () => {
    await setSub({ status: "canceled" });
    expect(await actions.cancelPlan()).toEqual({ ok: false, code: "sem_assinatura" });
    expect(await actions.previewPlan(avulso())).toEqual({ ok: false, code: "sem_assinatura" });
  });
});

describe("devolução", () => {
  const paidDaysAgo = (days: number) =>
    subscribeFamily(["familia"], { firstPaidAt: new Date(Date.now() - days * 86_400_000) });

  it("nos 7 dias da primeira cobrança devolve tudo, inclusive no anual", async () => {
    await paidDaysAgo(6);
    await setSub({ cycle: "ano" });
    expect(await actions.refundPlan()).toEqual({ ok: true, outcome: "devolvido" });
    expect(gateway.refundAndCancel).toHaveBeenCalledOnce();
  });

  it("depois dos 7 dias, não", async () => {
    await paidDaysAgo(8);
    expect(await actions.refundPlan()).toEqual({ ok: false, code: "sem_assinatura" });
    expect(gateway.refundAndCancel).not.toHaveBeenCalled();
  });

  it("uma vez só", async () => {
    await subscribeFamily(["familia"], { firstPaidAt: new Date(), refundedAt: new Date() });
    expect(await actions.refundPlan()).toEqual({ ok: false, code: "sem_assinatura" });
  });

  it("boleto não volta pela Stripe: a tela avisa, e a assinatura fica", async () => {
    await paidDaysAgo(1);
    gateway.refundAndCancel.mockResolvedValueOnce("boleto");
    expect(await actions.refundPlan()).toEqual({ ok: true, outcome: "boleto" });
  });
});

describe("portal", () => {
  it("só para quem já é cliente", async () => {
    expect(await actions.openPortal()).toEqual({ ok: false, code: "sem_assinatura" });
    await subscribeFamily(["familia"]);
    expect(await actions.openPortal()).toEqual({
      ok: true,
      url: "https://billing.example.com/portal",
    });
  });
});

describe("recorrência já paga", () => {
  it("`repeat` com `done` conta como lançamento, e no limite não grava nem a previsão", async () => {
    await subscribeFamily(["base:50"]);
    expect((await save({ repeat: "on", description: "Aluguel pago" })).ok).toBe(true);
    expect(await counted()).toBe(1);

    await seedEntries(49);
    const refused = await save({ repeat: "on", description: "Passou" });
    expect(refused.ok).toBe(false);
    const plans = await inFamily((tx) => tx.select().from(cashflowPlans));
    expect(plans.map((row) => row.description)).toEqual(["Aluguel pago"]);
  });

  it("previsão sem pagar não conta nem no limite", async () => {
    await subscribeFamily(["base:50"]);
    await seedEntries(50);
    expect((await save({ repeat: "on", description: "Só previsão", done: "" })).ok).toBe(true);
    expect(await counted()).toBe(50);
  });
});

describe("baixa de módulo desligado", () => {
  async function debtInstallment() {
    return inFamily(async (tx) => {
      await db.ensureFinanceDefaults(tx, family.id);
      const [debt] = await tx
        .insert(db.debts)
        .values({
          householdId: family.id,
          accountId: family.account,
          name: "Dívida",
          system: "manual",
          monthlyRate: "1.0000",
          originalBalance: "100.00",
        })
        .returning({ id: db.debts.id });
      const [row] = await tx
        .insert(db.debtInstallments)
        .values({
          householdId: family.id,
          debtId: debt!.id,
          number: 1,
          dueDate: today,
          amount: "10.00",
          principal: "9.00",
          interest: "1.00",
        })
        .returning({ id: db.debtInstallments.id });
      return row!.id;
    });
  }

  it("parcela de dívida fica guardada, sem baixa, até religar", async () => {
    const id = await debtInstallment();
    await subscribeFamily(["base:50"]);
    const notice = await confirmEntryNotice(form({ key: `d:${id}`, month: "" }));
    expect(notice).toContain("fora do seu plano");
    const [row] = await inFamily((tx) => tx.select().from(db.debtInstallments));
    expect(row?.transactionId).toBeNull();

    await subscribeFamily(["base:50", "modulo:dividas"]);
    expect(await confirmEntryNotice(form({ key: `d:${id}`, month: "" }))).toBeNull();
    const [paid] = await inFamily((tx) => tx.select().from(db.debtInstallments));
    expect(paid?.transactionId).not.toBeNull();
  });

  it("parcela de meta também", async () => {
    const [goal] = await inFamily((tx) =>
      tx
        .insert(goals)
        .values({
          householdId: family.id,
          name: "Carro",
          kind: "veiculo",
          targetAmount: "1000.00",
          accountId: family.account,
          createdBy: family.owner,
        })
        .returning({ id: goals.id }),
    );
    await inFamily((tx) =>
      tx.insert(db.goalContributions).values({
        householdId: family.id,
        goalId: goal!.id,
        month,
        amount: "100.00",
      }),
    );
    await subscribeFamily(["base:50"]);
    const notice = await confirmEntryNotice(form({ key: `g:${goal!.id}:${month}`, month }));
    expect(notice).toContain("fora do seu plano");
    expect(await inFamily((tx) => tx.select().from(transactions))).toEqual([]);
  });

  it("desfazer sugestão de módulo desligado não mexe em nada; com o módulo, desfaz", async () => {
    const contribution = async () => {
      const [row] = await inFamily((tx) => tx.select().from(db.retirementPlan));
      return row?.monthlyContribution;
    };
    const [row] = await inFamily(async (tx) => {
      await tx
        .insert(db.retirementPlan)
        .values({ householdId: family.id, monthlyContribution: "500.00" });
      return tx
        .insert(householdSuggestions)
        .values({
          householdId: family.id,
          agent: "aposentadoria",
          kind: "aporte_investimento",
          title: "Aporte",
          body: "Texto",
          dedupeKey: "aporte:desfazer",
          payload: { monthlyAmount: "500.00", previous: "100.00" },
          status: "aplicada",
          appliedBy: "agente",
        })
        .returning({ id: householdSuggestions.id });
    });
    await subscribeFamily(["base:50"]);
    expect((await undoSuggestion(form({ id: row!.id }))).ok).toBe(false);
    expect(await contribution()).toBe("500.00");
    const [still] = await inFamily((tx) => tx.select().from(householdSuggestions));
    expect(still?.status).toBe("aplicada");

    await subscribeFamily(["base:50", "modulo:aposentadoria"]);
    expect((await undoSuggestion(form({ id: row!.id }))).ok).toBe(true);
    expect(await contribution()).toBe("100.00");
  });
});

describe("cadastro complementar sem o módulo", () => {
  it("não grava o plano de aposentadoria, e o resto segue", async () => {
    await subscribeFamily(["base:50"]);
    await expect(
      saveRetirementStep(
        { ok: false, message: null },
        form({ retirementYear: "2050", targetIncome: "5.000,00", expectedYield: "6" }),
      ),
    ).rejects.toThrow("redirect");
    expect(await inFamily((tx) => tx.select().from(db.retirementPlan))).toEqual([]);
  });

  it("com o módulo, grava", async () => {
    await subscribeFamily(["base:50", "modulo:aposentadoria"]);
    await expect(
      saveRetirementStep(
        { ok: false, message: null },
        form({ retirementYear: "2050", targetIncome: "5.000,00", expectedYield: "6" }),
      ),
    ).rejects.toThrow("redirect");
    expect(await inFamily((tx) => tx.select().from(db.retirementPlan))).toHaveLength(1);
  });

  it("não cria a meta, e termina o cadastro", async () => {
    await subscribeFamily(["base:50"]);
    await expect(
      finishOnboarding(
        { ok: false, message: null },
        form({
          goalName: "Carro",
          goalKind: "veiculo",
          goalAmount: "10.000,00",
          goalMonth: "",
          goalAccount: family.account,
        }),
      ),
    ).rejects.toThrow("redirect");
    expect(await inFamily((tx) => tx.select().from(goals))).toEqual([]);
  });
});

describe("conta que troca de moeda", () => {
  it("editar para moeda fora do plano recusa, como criar", async () => {
    await subscribeFamily(["base:50"]);
    const edited = await saveAccount(
      { ok: false, message: null },
      form({
        id: family.account,
        name: "Conta",
        type: "corrente",
        currency: "USD",
        openingBalance: "",
      }),
    );
    expect(edited.ok).toBe(false);
    expect(edited.message).toContain("USD");
    const [row] = await inFamily((tx) => tx.select().from(accounts));
    expect(row?.currency).toBe("BRL");
  });
});

describe("apagar para a cobrança antes", () => {
  const typed = (over: Record<string, string> = {}) =>
    form({ id: family.id, confirm: "Família", ...over });
  const exists = async () =>
    (
      await db.withAdmin("teste", (admin) =>
        admin.select({ id: household.id }).from(household).where(eq(household.id, family.id)),
      )
    ).length > 0;

  it("o painel cancela na Stripe antes, e a família ainda existe nesse momento", async () => {
    await subscribeFamily(["familia"]);
    const seen: boolean[] = [];
    gateway.cancelNow.mockImplementationOnce(async () => {
      seen.push(await exists());
    });
    await expect(deleteFamily(typed())).rejects.toThrow("redirect:/admin/familias");
    expect(gateway.cancelNow).toHaveBeenCalledWith(`sub_web${families}`);
    expect(seen).toEqual([true]);
    expect(await exists()).toBe(false);
  });

  it("falhou na Stripe: recusa com mensagem, e nada é apagado", async () => {
    await subscribeFamily(["familia"]);
    gateway.cancelNow.mockRejectedValueOnce(new Error("rede"));
    const reply = await deleteFamily(typed());
    expect(reply).toMatchObject({ ok: false });
    expect(JSON.stringify(reply)).toContain("Nada foi apagado");
    expect(await exists()).toBe(true);
  });

  it("nome errado não cancela nada", async () => {
    await subscribeFamily(["familia"]);
    expect(await deleteFamily(typed({ confirm: "Outra" }))).toMatchObject({ ok: false });
    expect(gateway.cancelNow).not.toHaveBeenCalled();
  });

  it("assinatura já cancelada não vai à Stripe", async () => {
    await subscribeFamily(["familia"], { status: "canceled" });
    await expect(deleteFamily(typed())).rejects.toThrow("redirect");
    expect(gateway.cancelNow).not.toHaveBeenCalled();
  });

  it("excluir a conta pelo painel leva a mesma regra", async () => {
    await subscribeFamily(["familia"]);
    gateway.cancelNow.mockRejectedValueOnce(new Error("rede"));
    const reply = await deleteUser(form({ id: family.owner, confirm: "EXCLUIR" }));
    expect(JSON.stringify(reply)).toContain("Nada foi apagado");
    expect(await exists()).toBe(true);

    await expect(deleteUser(form({ id: family.owner, confirm: "EXCLUIR" }))).rejects.toThrow(
      "redirect:/admin/usuarios",
    );
    expect(await exists()).toBe(false);
  });

  it("apagar a própria conta: recusa com a mensagem certa se a Stripe falhar", async () => {
    await subscribeFamily(["familia"]);
    gateway.cancelNow.mockRejectedValueOnce(new Error("rede"));
    await expect(closeOwnHouseholds(family.owner)).rejects.toMatchObject({
      body: { message: "BILLING_CANCEL_FAILED" },
    });
    expect(await exists()).toBe(true);
    await closeOwnHouseholds(family.owner);
    expect(gateway.cancelNow).toHaveBeenLastCalledWith(`sub_web${families}`);
    expect(await exists()).toBe(false);
  });
});

describe("uma assinatura por família", () => {
  const FAMILY = domain.FAMILY_SELECTION;

  it("cria o cliente antes do pagamento, e reaproveita nas tentativas seguintes", async () => {
    await actions.subscribe(FAMILY);
    await actions.subscribe(FAMILY);
    expect(gateway.createCustomer).toHaveBeenCalledOnce();
    expect(gateway.createCustomer).toHaveBeenCalledWith(family.id);
    const calls = gateway.createCheckout.mock.calls as unknown as Array<[{ customerId: string }]>;
    expect(calls.map(([call]) => call.customerId)).toEqual(["cus_web_novo", "cus_web_novo"]);
  });

  it("expira o pagamento anterior antes de abrir outro", async () => {
    await actions.subscribe(FAMILY);
    expect(gateway.expireCheckout).not.toHaveBeenCalled();
    const first = await gateway.createCheckout.mock.results[0]!.value;
    await actions.subscribe(FAMILY);
    expect(gateway.expireCheckout).toHaveBeenCalledWith(first.id);
  });

  it("pagamento anterior já pago: não abre outro", async () => {
    await actions.subscribe(FAMILY);
    gateway.expireCheckout.mockResolvedValueOnce(true);
    expect(await actions.subscribe(FAMILY)).toEqual({ ok: false, code: "em_andamento" });
    expect(gateway.createCheckout).toHaveBeenCalledOnce();
  });

  it("assinatura viva na Stripe, com o webhook ainda a caminho: não abre outro", async () => {
    gateway.hasLiveSubscription.mockResolvedValueOnce(true);
    expect(await actions.subscribe(FAMILY)).toEqual({ ok: false, code: "em_andamento" });
    expect(gateway.createCheckout).not.toHaveBeenCalled();
  });

  it("dois cliques ao mesmo tempo: um só chega à Stripe", async () => {
    let markEntered!: () => void;
    let releaseCheckout!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseCheckout = resolve;
    });
    gateway.createCheckout.mockImplementationOnce(async () => {
      markEntered();
      await release;
      return { id: "cs_concorrente", url: "https://checkout.example.com/sessao" };
    });

    const first = actions.subscribe(FAMILY);
    let second: Awaited<ReturnType<typeof actions.subscribe>>;
    try {
      // Mantém a primeira chamada na região protegida até a segunda terminar.
      await entered;
      second = await actions.subscribe(FAMILY);
    } finally {
      releaseCheckout();
      await first;
    }
    const replies = [await first, second];
    expect(replies.filter((reply) => reply.ok)).toHaveLength(1);
    expect(replies.filter((reply) => !reply.ok)).toEqual([{ ok: false, code: "em_andamento" }]);
    expect(gateway.createCheckout).toHaveBeenCalledOnce();
  });

  it("erro da Stripe solta a trava", async () => {
    gateway.createCheckout.mockRejectedValueOnce(new Error("rede"));
    expect(await actions.subscribe(FAMILY)).toEqual({ ok: false, code: "falhou" });
    expect((await actions.subscribe(FAMILY)).ok).toBe(true);
  });
});

describe("mensal para anual", () => {
  it("a prévia mostra o plano pedido, o que sai agora e a próxima cobrança daqui a um ano", async () => {
    const prices = await db.readBillingCatalog();
    const stored = ["base:200", "modulo:dividas", "modulo:investimentos"].map((item) => {
      const row = prices.find((price) => price.item === item && price.cycle === "mes")!;
      return { price: row.stripePriceId!, item, amount: row.amount, quantity: 1 };
    });
    await subscribeFamily(["base:200"], { items: stored });
    const target = {
      family: false,
      entries: "200" as const,
      modules: [],
      messages: 0 as const,
      currencies: [],
      connectedAccounts: 0,
      cycle: "ano" as const,
    };
    const reply = await actions.previewPlan(target);
    if (!reply.ok) throw new Error(reply.code);
    expect(reply.preview).toMatchObject({ nextTotal: "199.00", laterAt: null, dueNow: "3.20" });
    expect(reply.preview.removed.toSorted()).toEqual(
      ["modulo:dividas", "modulo:investimentos"].toSorted(),
    );
    const inYear = Date.now() + 360 * 24 * 60 * 60 * 1000;
    expect(new Date(reply.preview.nextChargeAt!).getTime()).toBeGreaterThan(inYear);
    expect(gateway.previewChange).toHaveBeenCalledWith(`sub_web${families}`, [
      { price: "price_base_200_ano", quantity: 1 },
    ]);
  });
});

describe("devolução pela metade", () => {
  it("assinatura já encerrada ainda conclui a devolução", async () => {
    await subscribeFamily(["familia"], { status: "canceled", firstPaidAt: new Date() });
    expect(await actions.refundPlan()).toEqual({ ok: true, outcome: "devolvido" });
  });
});
