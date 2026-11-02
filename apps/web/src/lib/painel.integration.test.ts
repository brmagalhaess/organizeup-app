// Prova cruzada do painel: uma família fictícia de vários meses, lançada pelas server actions de verdade,
// e, para o mesmo mês, o painel, `/app/lancamentos` e os relatórios têm de dar o mesmo número, centavo por
// centavo. Postgres real com RLS. O dia é fixo, 15/11/2026. A cotação de hoje é a última gravada, a PTAX de
// 30/10/2026; as de setembro são inventadas, e `market_fx` é compartilhada com os outros testes.
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { TenantContext } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.worker;
process.env.ADMIN_DATABASE_URL = urls.admin;

let ctx: TenantContext;
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({
  requireTenant: async () => ({ ctx, session: { user: { id: ctx.userId, name: "Dona" } } }),
}));
vi.mock("@/i18n/money-server", () => ({ forgetFamilyCurrency: async () => undefined }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { messagesFor } = await import("@/i18n/messages");
  return {
    getLocale: async () => "pt-BR",
    getMessages: async () => messagesFor("pt-BR"),
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "pt-BR", messages: messagesFor("pt-BR"), namespace } as never),
  };
});

const db = await import("@organizeup/db");
const agents = await import("@organizeup/agents");
const domain = await import("@organizeup/domain");
const { bootstrapHousehold } = await import("@/app/app/actions");
const { saveEntry, confirmEntry } = await import("@/app/app/(painel)/lancamentos/actions");
const { createTransfer } = await import("@/app/app/(painel)/contas/actions");
const { addAsset } = await import("@/app/app/(painel)/investimentos/actions");
const { loadAccountBalances, loadMonth, loadOverview } = await import("@/lib/finance-data");
const { loadMonthInvestments } = await import("@/lib/investments");

const { accounts, categories, eq, and, household, householdMember, user } = db;
const { cardPurchases, cashflowPlans, creditCards, dividends, householdSettings } = db;
const { investments } = db;

const TODAY = "2026-11-15";
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const initial = { ok: false, message: null };

let families = 0;
async function newFamily(currency = "BRL") {
  families += 1;
  const id = `hh-painel-${families}`;
  const owner = `user-painel-${families}`;
  await db.withAdmin("seed do teste do painel", async (admin) => {
    await admin.insert(user).values({ id: owner, name: "Dona", email: `${owner}@example.com` });
    await admin.insert(household).values({ id, name: "Painel", slug: id });
    await admin
      .insert(householdMember)
      .values({ id: `m-${id}`, organizationId: id, userId: owner, role: "owner" });
  });
  const session = await db.fromSession({
    user: { id: owner },
    session: { activeOrganizationId: id },
  });
  if (!session) throw new Error("sem contexto");
  ctx = session;
  expect((await bootstrapHousehold({ city: "", state: "", currency })).ok).toBe(true);
  await db.withWorkerHousehold(id, (tx) => db.ensureFinanceDefaults(tx, id));
  return { id, ctx: session };
}

type Family = Awaited<ReturnType<typeof newFamily>>;
const inFamily = <T>(family: Family, fn: Parameters<typeof db.withWorkerHousehold<T>>[1]) =>
  db.withWorkerHousehold(family.id, fn);

const categoryId = (family: Family, name: string, kind: "receita" | "despesa") =>
  inFamily(family, async (tx) => (await db.ensureCategory(tx, family.id, kind, name, false)).id);

async function entry(
  accountId: string,
  category: string,
  date: string,
  amount: string,
  over: Record<string, string> = {},
) {
  const saved = await saveEntry(
    initial,
    form({
      key: "",
      kind: "despesa",
      description: "Lançamento",
      amount,
      date,
      categoryId: category,
      accountId,
      done: "on",
      ...over,
    }),
  );
  expect(saved.ok).toBe(true);
}

const runAgent = (family: Family, today: string) =>
  inFamily(family, (tx) => agents.runRelatoriosAgent(tx, { today, householdId: family.id }));

const statement = async (family: Family, kind: "resumo" | "categorias" | "proventos", p: string) =>
  inFamily(family, (tx) => agents.readStatement(tx, kind, p));

const figure = (row: { data: unknown } | null, id: string) =>
  (row?.data as { figures: Array<{ id: string; value: unknown }> } | undefined)?.figures.find(
    (item) => item.id === id,
  )?.value;

/** Painel e lançamentos pelo mesmo mês, e o relatório de Resumo quando o mês já tem um. */
async function expectSameNumbers(family: Family, month: string) {
  const panel = await loadOverview(family.ctx, month);
  const screen = await loadMonth(family.ctx, month);
  expect(panel.period.month).toBe(month);
  expect(panel.summary).toEqual(screen.summary);

  const report = await statement(family, "resumo", month);
  if (report) {
    expect(figure(report, "received")).toEqual({ money: panel.summary.received });
    expect(figure(report, "spent")).toEqual({ money: panel.summary.spent });
    expect(figure(report, "left")).toEqual({ money: panel.summary.balance });
  }
  const point = panel.series.at(-1)!;
  expect(point).toMatchObject({
    month,
    received: panel.summary.received,
    spent: panel.summary.spent,
    plannedExpense: panel.summary.plannedExpense,
  });
  const byAccount = (field: "received" | "spent" | "plannedIncome" | "plannedExpense") =>
    domain.toDbAmount(panel.accounts.reduce((acc, row) => acc.plus(row[field]), domain.money(0)));
  expect(byAccount("received")).toBe(panel.summary.received);
  expect(byAccount("spent")).toBe(panel.summary.spent);
  expect(byAccount("plannedIncome")).toBe(panel.summary.plannedIncome);
  expect(byAccount("plannedExpense")).toBe(panel.summary.plannedExpense);

  // As categorias abrem o cartão e fecham no total de despesas, feito mais previsto.
  const total = domain.foldCategories(panel.expenses).total;
  expect(total).toBe(
    domain.toDbAmount(domain.money(panel.summary.spent).plus(panel.summary.plannedExpense)),
  );
  const incomes = domain.foldCategories(panel.incomes).total;
  expect(incomes).toBe(
    domain.toDbAmount(domain.money(panel.summary.received).plus(panel.summary.plannedIncome)),
  );
  const categoryReport = await statement(family, "categorias", month);
  if (categoryReport) expect(figure(categoryReport, "total")).toEqual({ money: total });
  return panel;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(`${TODAY}T15:00:00Z`) });
  await db.saveMarketFx(
    (
      [
        ["2026-09-01", "4.80000000"],
        ["2026-09-30", "5.00000000"],
        ["2026-10-30", "5.42120000"],
      ] as const
    ).map(([date, rate]) => ({ currency: "USD" as const, date, rate, source: "teste" })),
  );
});

beforeEach(() => {
  vi.setSystemTime(new Date(`${TODAY}T15:00:00Z`));
});

afterAll(async () => {
  vi.useRealTimers();
  await db.closeAllPools();
});

/**
 * Família em real, com conta em dólar. Setembro: salário, recebimento em dólar, mercado, aluguel pago.
 * Outubro: salário, fatura paga, aporte que gera lançamento, transferência e o aluguel em aberto. Compra de
 * 3 parcelas em setembro e outra à vista em outubro.
 */
async function fullFamily() {
  const family = await newFamily();
  const ids = await inFamily(family, async (tx) => {
    const [main] = await tx.select().from(accounts);
    await tx.update(accounts).set({ openingBalance: "1000.00" }).where(eq(accounts.id, main!.id));
    const [dollars] = await tx
      .insert(accounts)
      .values({ householdId: family.id, name: "Conta em dólar", currency: "USD" })
      .returning();
    return { main: main!.id, dollars: dollars!.id };
  });
  const salary = await categoryId(family, "Salário", "receita");
  const market = await categoryId(family, "Mercado", "despesa");
  const home = await categoryId(family, "Moradia", "despesa");
  const freela = await categoryId(family, "Freela", "receita");

  const [card, plan] = await inFamily(family, async (tx) => {
    const [row] = await tx
      .insert(creditCards)
      .values({
        householdId: family.id,
        name: "Visa",
        closingDay: 28,
        dueDay: 10,
        payingAccountId: ids.main,
      })
      .returning();
    await tx.insert(cardPurchases).values([
      {
        householdId: family.id,
        cardId: row!.id,
        categoryId: market,
        description: "Geladeira",
        amount: "1200.00",
        installments: 3,
        purchasedOn: "2026-09-15",
      },
      {
        householdId: family.id,
        cardId: row!.id,
        categoryId: home,
        description: "Cortina",
        amount: "300.00",
        purchasedOn: "2026-10-02",
      },
    ]);
    const [rent] = await tx
      .insert(cashflowPlans)
      .values({
        householdId: family.id,
        accountId: ids.main,
        categoryId: home,
        kind: "despesa",
        description: "Aluguel",
        amount: "1500.00",
        dayOfMonth: 10,
        startMonth: "2026-09",
      })
      .returning();
    return [row!, rent!];
  });

  await entry(ids.main, salary, "2026-09-05", "5.000,00", { kind: "receita" });
  // Recebimento em dólar, pela cotação do dia: 200 × 4,80 = 960 na moeda principal.
  await entry(ids.dollars, freela, "2026-09-20", "200,00", { kind: "receita" });
  await entry(ids.main, market, "2026-09-12", "800,00");
  await confirmEntry(form({ key: `p:${plan.id}`, month: "2026-09" }));

  await entry(ids.main, salary, "2026-10-05", "5.000,00", { kind: "receita" });
  await confirmEntry(form({ key: `f:${card.id}:2026-10`, month: "2026-10" }));
  const asset = await addAsset(
    initial,
    form({
      name: "CDB de teste",
      assetClass: "renda_fixa",
      occurredOn: "2026-10-12",
      amount: "1.000,00",
      accountId: ids.main,
    }),
  );
  expect(asset.ok).toBe(true);
  const moved = await createTransfer(
    initial,
    form({
      fromAccountId: ids.main,
      toAccountId: ids.dollars,
      amount: "540,00",
      toAmount: "100,00",
      occurredOn: "2026-10-25",
      note: "",
    }),
  );
  expect(moved.ok).toBe(true);

  await runAgent(family, "2026-11-01");
  await runAgent(family, TODAY);
  return { family, ids, card };
}

describe("prova cruzada", () => {
  let scenario: Awaited<ReturnType<typeof fullFamily>>;
  beforeAll(async () => {
    scenario = await fullFamily();
  });
  beforeEach(() => {
    ctx = scenario.family.ctx;
  });

  it("painel, lançamentos e relatório dão o mesmo número em cada mês", async () => {
    for (const month of ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]) {
      await expectSameNumbers(scenario.family, month);
    }
  });

  it("setembro: recebimento em dólar entra pela cotação do lançamento", async () => {
    const { summary } = await expectSameNumbers(scenario.family, "2026-09");
    expect(summary).toMatchObject({
      received: "5960.00",
      spent: "2300.00",
      balance: "3660.00",
      plannedExpense: "0.00",
    });
  });

  it("outubro: fatura paga e aporte entram; a transferência não", async () => {
    const panel = await expectSameNumbers(scenario.family, "2026-10");
    expect(panel.summary).toMatchObject({
      received: "5000.00",
      // Fatura de 400 mais aporte de 1.000. O aluguel de 1.500 ficou em aberto.
      spent: "1400.00",
      plannedExpense: "1500.00",
      balance: "3600.00",
    });
    // Aporte fica nos totais, como no relatório, e a tela diz quanto é.
    expect(panel.savings).toEqual({ out: "1000.00", in: "0.00" });
  });

  it("a fatura abre por categoria sem contar duas vezes", async () => {
    const { expenses, categoryNames } = await loadOverview(ctx, "2026-10");
    const named = expenses.map((row) => [categoryNames.get(row.categoryId), row.amount, row.done]);
    expect(named).toEqual([
      ["Moradia", "1500.00", "0.00"],
      [domain.CONTRIBUTION_CATEGORY, "1000.00", "1000.00"],
      ["Mercado", "400.00", "400.00"],
    ]);
  });

  it("novembro: fatura aberta com a parcela e a compra à vista", async () => {
    const panel = await expectSameNumbers(scenario.family, "2026-11");
    expect(panel.summary).toMatchObject({
      spent: "0.00",
      plannedExpense: "2200.00",
    });
    expect(panel.period).toMatchObject({ phase: "atual", previous: "2026-10" });
    const [visa] = panel.cards;
    expect(visa).toMatchObject({ statement: "700.00", status: "atrasada", ahead: "400.00" });
  });

  it("cada conta tem o seu saldo e o seu movimento, e o cartão não soma de novo", async () => {
    const panel = await loadOverview(ctx, "2026-10");
    const { main, dollars } = scenario.ids;
    const row = (id: string) => panel.accounts.find((account) => account.id === id)!;
    expect(row(main)).toMatchObject({
      received: "5000.00",
      spent: "1400.00",
      balance: "6760.00",
      foreign: false,
    });
    expect(row(dollars)).toMatchObject({
      received: "0.00",
      spent: "0.00",
      nativeBalance: "300.00",
      balance: "1626.36",
      foreign: true,
    });
    expect(panel.cards).toEqual([
      expect.objectContaining({ statement: "400.00", status: "paga", ahead: "1100.00" }),
    ]);
  });

  it("saldo de mês passado usa a cotação daquele mês, não a de hoje", async () => {
    const september = await loadOverview(ctx, "2026-09");
    // 200 dólares a 5,00, de 30/09. Nem a do lançamento (4,80) nem a de hoje (5,4212).
    const dollars = september.accounts.find((row) => row.id === scenario.ids.dollars)!;
    expect(dollars).toMatchObject({ nativeBalance: "200.00", balance: "1000.00" });
    expect(september.balance).toMatchObject({
      value: "4700.00",
      asOf: "2026-09-30",
      fx: { date: "2026-09-30", missing: [] },
    });
    const october = await loadOverview(ctx, "2026-10");
    expect(october.balance).toMatchObject({ value: "8386.36", asOf: "2026-10-31" });
    const { accounts: now } = await loadAccountBalances(ctx);
    expect(now.find((row) => row.id === scenario.ids.dollars)?.balance).toBe("1626.36");
  });

  it("mês atual mostra o saldo de hoje; mês futuro projeta pelos previstos", async () => {
    const november = await loadOverview(ctx, "2026-11");
    expect(november.balance).toMatchObject({ value: "8386.36", projected: "6186.36" });
    const december = await loadOverview(ctx, "2026-12");
    // Hoje, menos 2.200 de novembro, menos 1.900 de dezembro (aluguel e última parcela).
    expect(december.balance.value).toBe("4286.36");
    expect(december.period.phase).toBe("futuro");
    const row = december.accounts.find((account) => account.id === scenario.ids.main)!;
    expect(row.projected).toBe("2660.00");
  });

  it("a evolução traz 12 meses, com o previsto à parte", async () => {
    const { series } = await loadOverview(ctx, "2026-11");
    expect(series.map((point) => point.month)).toEqual(domain.recentMonths("2026-11", 12));
    expect(series.at(-2)).toEqual({
      month: "2026-10",
      received: "5000.00",
      spent: "1400.00",
      balance: "3600.00",
      plannedIncome: "0.00",
      plannedExpense: "1500.00",
    });
  });

  it("próximos vencimentos seguem hoje, seja qual for o mês", async () => {
    const past = await loadOverview(ctx, "2026-09");
    const now = await loadOverview(ctx, "2026-11");
    expect(past.pending).toEqual(now.pending);
    expect(now.pending.some((entry) => entry.description === "Aluguel")).toBe(true);
  });

  it("mês inválido, repetido ou fora da faixa cai no mês atual", async () => {
    for (const month of ["abc", "2026-13", ["2026-10", "2026-09"], "2020-01", "2030-01"]) {
      const panel = await loadOverview(ctx, month);
      expect(panel.period.month).toBe("2026-11");
    }
    expect((await loadOverview(ctx)).period.first).toBe("2026-09");
  });

  it("aportes do mês saem das operações; a carteira é a de hoje", async () => {
    const october = await loadMonthInvestments(ctx, "2026-10");
    expect(october).toMatchObject({ bought: "1000.00", investedAtEnd: "1000.00", past: true });
    const september = await loadMonthInvestments(ctx, "2026-09");
    expect(september).toMatchObject({ bought: "0.00", investedAtEnd: "0.00", total: "1000.00" });
    const future = await loadMonthInvestments(ctx, "2026-12");
    expect(future).toMatchObject({ future: true, investedAtEnd: null });
    const november = await loadMonthInvestments(ctx, "2026-11");
    expect(november.investedAtEnd).toBeNull();
    expect(november.classes).toEqual([
      expect.objectContaining({ assetClass: "renda_fixa", value: "1000.00", percent: 100 }),
    ]);
  });

  it("proventos batem com o relatório, e anúncio é só o que está na tabela", async () => {
    const { family } = scenario;
    await inFamily(family, async (tx) => {
      const [asset] = await tx.select().from(investments);
      await tx.insert(dividends).values(
        [
          ["2026-10-15", "100.00", "15.00"],
          ["2026-11-05", "50.00", "0.00"],
          ["2026-11-25", "30.00", "0.00"],
          ["2026-12-20", "40.00", "0.00"],
        ].map(([paidOn, gross, withheld]) => ({
          householdId: family.id,
          investmentId: asset!.id,
          kind: "dividendo" as const,
          paidOn: paidOn!,
          gross: gross!,
          withheld: withheld!,
        })),
      );
    });
    await runAgent(family, TODAY);
    const november = await loadMonthInvestments(ctx, "2026-11");
    expect(november.dividends).toMatchObject({
      received: "50.00",
      announced: "30.00",
      ahead: "40.00",
      last12: "135.00",
    });
    const report = await statement(family, "proventos", "2026-11");
    expect(figure(report, "month")).toEqual({ money: november.dividends.received });
    expect(figure(report, "last12")).toEqual({ money: november.dividends.last12 });
    const october = await loadMonthInvestments(ctx, "2026-10");
    expect(october.dividends).toMatchObject({ received: "85.00", last12: "85.00", estimate: null });
    // Provento não vira receita: as telas de dinheiro continuam iguais.
    await expectSameNumbers(family, "2026-11");
  });

  it("filtro por categoria mostra as compras do cartão que a fatura esconde", async () => {
    const screen = await loadMonth(ctx, "2026-10");
    const total = domain.linesTotal(screen.cardLines);
    expect(total).toBe("400.00");
    const [market] = await inFamily(scenario.family, (tx) =>
      tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.name, "Mercado"), eq(categories.kind, "despesa"))),
    );
    expect(screen.cardLines.filter((line) => line.categoryId === market!.id)).toHaveLength(1);
  });
});

describe("família em dólar", () => {
  it("batem painel, lançamentos e relatório, e o saldo em real usa a cotação do mês", async () => {
    const family = await newFamily("USD");
    const { main, real } = await inFamily(family, async (tx) => {
      const [own] = await tx.select().from(accounts);
      const [brl] = await tx
        .insert(accounts)
        .values({ householdId: family.id, name: "Banco no Brasil", currency: "BRL" })
        .returning();
      return { main: own!.id, real: brl!.id };
    });
    const pay = await categoryId(family, "Freela", "receita");
    const market = await categoryId(family, "Viagem", "despesa");
    await entry(main, pay, "2026-10-05", "3.000,00", { kind: "receita" });
    // Conta em real é a estrangeira. 480 reais a 4,80 por dólar: 100 dólares.
    await entry(real, pay, "2026-09-20", "480,00", { kind: "receita" });
    // 1.000 reais a 5,00 por dólar, a cotação de 30/09: 200 dólares.
    await entry(real, pay, "2026-10-06", "1.000,00", { kind: "receita" });
    await entry(main, market, "2026-10-07", "450,50");
    const moved = await createTransfer(
      initial,
      form({
        fromAccountId: main,
        toAccountId: real,
        amount: "100,00",
        toAmount: "542,12",
        occurredOn: "2026-10-30",
        note: "",
      }),
    );
    expect(moved.ok).toBe(true);
    await runAgent(family, "2026-11-01");
    await runAgent(family, TODAY);

    const panel = await expectSameNumbers(family, "2026-10");
    expect(panel.summary).toMatchObject({
      received: "3200.00",
      spent: "450.50",
      balance: "2749.50",
    });
    const brl = panel.accounts.find((account) => account.id === real)!;
    expect(brl).toMatchObject({ nativeBalance: "2022.12", foreign: true, balance: "373.00" });
    expect(panel.balance.fx).toEqual({ date: "2026-10-30", missing: [] });
    // Setembro fecha com a cotação de 30/09: 480 reais a 5,00 são 96 dólares, não os 100 do lançamento.
    const september = await expectSameNumbers(family, "2026-09");
    const before = september.accounts.find((account) => account.id === real)!;
    expect(before).toMatchObject({ nativeBalance: "480.00", balance: "96.00" });
  });
});

describe("casos de borda", () => {
  it("conta nova: sem nada, tela de boas-vindas e mês atual", async () => {
    const family = await newFamily();
    const panel = await loadOverview(family.ctx);
    expect(panel.fresh).toBe(true);
    expect(panel.period).toMatchObject({ month: "2026-11", first: "2026-11", previous: null });
    expect(panel.accounts).toHaveLength(1);
    expect(domain.hasAnything(panel.summary)).toBe(false);
  });

  it("sem cotação no mês, a conta sai da soma e a tela sabe qual moeda faltou", async () => {
    const family = await newFamily();
    await inFamily(family, async (tx) => {
      const [own] = await tx.select().from(accounts);
      await tx.insert(accounts).values({
        householdId: family.id,
        name: "Conta antiga em dólar",
        currency: "USD",
        openingBalance: "100.00",
      });
      const category = await db.ensureCategory(tx, family.id, "despesa", "Mercado", false);
      await tx.insert(db.transactions).values({
        householdId: family.id,
        accountId: own!.id,
        categoryId: category.id,
        kind: "despesa",
        description: "Antes da primeira cotação",
        amount: "10.00",
        occurredOn: "2026-02-10",
      });
    });
    const panel = await loadOverview(family.ctx, "2026-02");
    expect(panel.balance.value).toBe("-10.00");
    expect(panel.balance.fx).toEqual({ date: null, missing: ["USD"] });
  });

  it("conta arquivada sai do saldo e só aparece se teve movimento no mês", async () => {
    const family = await newFamily();
    const salary = await categoryId(family, "Salário", "receita");
    const closed = await inFamily(family, async (tx) => {
      const [row] = await tx
        .insert(accounts)
        .values({ householdId: family.id, name: "Antiga", openingBalance: "50.00" })
        .returning();
      return row!.id;
    });
    await entry(closed, salary, "2026-10-05", "100,00", { kind: "receita" });
    await inFamily(family, (tx) =>
      tx.update(accounts).set({ archived: true }).where(eq(accounts.id, closed)),
    );
    const october = await loadOverview(family.ctx, "2026-10");
    expect(october.balance.value).toBe("0.00");
    expect(october.accounts.some((row) => row.id === closed)).toBe(true);
    const november = await loadOverview(family.ctx, "2026-11");
    expect(november.accounts.some((row) => row.id === closed)).toBe(false);
  });

  it("virada de ano no fuso da família", async () => {
    const family = await newFamily();
    await inFamily(family, (tx) =>
      tx.update(householdSettings).set({ timezone: "America/Sao_Paulo" }),
    );
    const salary = await categoryId(family, "Salário", "receita");
    const [main] = await inFamily(family, (tx) => tx.select().from(accounts));
    await entry(main!.id, salary, "2026-12-31", "10,00", { kind: "receita" });
    await entry(main!.id, salary, "2027-01-01", "20,00", { kind: "receita" });
    // 22h de 31/12 em São Paulo, já 1º de janeiro em UTC.
    vi.setSystemTime(new Date("2027-01-01T01:00:00Z"));
    const december = await loadOverview(family.ctx);
    expect(december.period).toMatchObject({ month: "2026-12", phase: "atual", next: "2027-01" });
    expect(december.summary.received).toBe("10.00");
    const january = await loadOverview(family.ctx, "2027-01");
    expect(january.period.phase).toBe("futuro");
    expect(january.previousSummary.received).toBe("10.00");
    expect(january.summary.received).toBe("20.00");
    vi.setSystemTime(new Date("2027-01-01T04:00:00Z"));
    const next = await loadOverview(family.ctx);
    expect(next.period).toMatchObject({ month: "2027-01", phase: "atual", previous: "2026-12" });
  });

  it("não lê movimento de outra família", async () => {
    const other = await newFamily();
    const empty = await newFamily();
    const category = await categoryId(other, "Mercado", "despesa");
    const [account] = await inFamily(other, (tx) => tx.select().from(accounts));
    await inFamily(other, (tx) =>
      tx.insert(db.transactions).values({
        householdId: other.id,
        accountId: account!.id,
        categoryId: category,
        kind: "despesa",
        description: "De outra família",
        amount: "10.00",
        occurredOn: "2025-02-10",
      }),
    );
    const panel = await loadOverview(empty.ctx, "2025-02");
    expect(panel.period).toMatchObject({ month: "2026-11", first: "2026-11" });
    expect(panel.fresh).toBe(true);
  });
});
