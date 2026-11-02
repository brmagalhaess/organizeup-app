// Rodada real dos relatórios (ADR-0021): Postgres com migrações e RLS, pela conexão do worker, com
// `fromJob` e `withHousehold`, sem mock. Os números esperados foram somados à mão a partir dos lançamentos
// do `seed`, sem chamar `packages/domain`: se a regra mudar, o teste tem de discordar. Dados fictícios.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TenantContext, TenantTx } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.worker;
process.env.ADMIN_DATABASE_URL = urls.admin;

const db = await import("@organizeup/db");
const agents = await import("../src/index");
const domain = await import("@organizeup/domain");

const {
  accounts,
  and,
  assets,
  cardPurchases,
  cardStatementPayments,
  cashflowPlans,
  categories,
  creditCards,
  debtInstallments,
  debts,
  dividendGoals,
  dividends,
  eq,
  goalContributions,
  goals,
  household,
  householdMember,
  householdSettings,
  householdStatements,
  incomeReceipts,
  incomeSources,
  investments,
  investmentTargets,
  investmentTrades,
  netWorthSnapshots,
  people,
  retirementPlan,
  transactions,
  tripCosts,
  tripPeople,
  trips,
  user,
} = db;

interface Family {
  id: string;
  job: TenantContext;
}

let families = 0;
async function newFamily(
  settings: { mainCurrency?: "BRL" | "USD"; timezone?: string } = {},
): Promise<Family> {
  families += 1;
  const id = `hh-real-${families}`;
  const owner = `user-real-${families}`;
  await db.withAdmin("seed da rodada real", async (admin) => {
    await admin
      .insert(user)
      .values({ id: owner, name: "Pessoa Teste", email: `${owner}@example.com` });
    await admin.insert(household).values({ id, name: "Grupo Teste", slug: id });
    await admin
      .insert(householdMember)
      .values({ id: `m-${id}`, organizationId: id, userId: owner, role: "owner" });
  });
  const job = db.fromJob({ householdId: id });
  await db.withHousehold(job, async (tx) => {
    await tx
      .insert(householdSettings)
      .values({ householdId: id, retirementYear: 2040, ...settings });
    await db.ensureFinanceDefaults(tx, id);
  });
  return { id, job };
}

const inFamily = <T>(family: Family, fn: (tx: TenantTx) => Promise<T>) =>
  db.withHousehold(family.job, fn);

/** Como o worker chama: `withHousehold` com o contexto de `fromJob`, uma transação por rodada. */
const run = (family: Family, today: string) =>
  inFamily(family, (tx) => agents.runRelatoriosAgent(tx, { today, householdId: family.id }));

const read = async (
  family: Family,
  kind: Parameters<typeof agents.readStatement>[1],
  p: string,
) => {
  const row = await inFamily(family, (tx) => agents.readStatement(tx, kind, p));
  if (!row) throw new Error(`sem relatório ${kind} ${p}`);
  return row;
};

const all = (family: Family) => inFamily(family, (tx) => tx.select().from(householdStatements));

type Data = Awaited<ReturnType<typeof read>>["data"];

const figure = (data: Data, id: string) =>
  data.figures.find((item) => item.id === id)?.value ?? null;
const figures = (data: Data) =>
  Object.fromEntries(data.figures.map((item) => [item.id, item.value]));
const section = (data: Data, id: string) =>
  data.sections.find((item) => item.id === id)?.rows ?? null;

const key = (row: { kind: string; period: string }) => `${row.kind}:${row.period}`;
const sorted = <T extends { kind: string; period: string }>(rows: T[]) =>
  [...rows].sort((a, b) => key(a).localeCompare(key(b)));

interface Refs {
  main: string;
  dollar: string;
  category: (name: string, kind?: "receita" | "despesa") => string;
}

async function refs(tx: TenantTx): Promise<Refs> {
  const [main] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
  const rows = await tx.select().from(categories);
  return {
    main: main!.id,
    dollar: "",
    category: (name, kind = "despesa") => {
      const found = rows.find((row) => row.name === name && row.kind === kind);
      if (!found) throw new Error(`sem categoria ${name}`);
      return found.id;
    },
  };
}

interface Line {
  on: string;
  amount: string;
  category: string;
  kind?: "receita" | "despesa";
  description?: string;
  account?: string;
  status?: "previsto" | "realizado";
  source?: "familia" | "agente" | "importacao" | "revisar";
  usd?: { amount: string; rate: string };
}

async function put(tx: TenantTx, family: Family, ref: Refs, line: Line) {
  const kind = line.kind ?? "despesa";
  const [row] = await tx
    .insert(transactions)
    .values({
      householdId: family.id,
      accountId: line.account ?? ref.main,
      categoryId: ref.category(line.category, kind),
      kind,
      description: line.description ?? line.category,
      amount: line.amount,
      occurredOn: line.on,
      status: line.status ?? "realizado",
      categorySource: line.source ?? "familia",
      ...(line.usd
        ? {
            originalAmount: line.usd.amount,
            originalCurrency: "USD" as const,
            fxRate: line.usd.rate,
          }
        : {}),
    })
    .returning({ id: transactions.id });
  return row!.id;
}

const receita = (on: string, amount: string, category = "Salário"): Line => ({
  on,
  amount,
  category,
  kind: "receita",
});

/**
 * Família de prova, em reais, com conta em dólar:
 *
 *            dez/25    ago/26    set/26      out/26
 * entrou    7000,00   8000,00   8500,00     8200,00
 * saiu      1000,00   2900,00   4334,50     5578,58
 * sobrou    6000,00   5100,00   4165,50     2621,42
 *
 * Saídas de outubro: 2000,00 moradia + 1100,25 mercado + 633,33 fatura + 1075,00 parcela + 270,00 lazer
 * em dólar (US$ 50 × 5,40) + 500,00 meta. Previstos em aberto: 150,00 de saúde e 100,00 de assinatura.
 *
 * Cartão, fecha dia 25 e vence dia 5: mercado 300,00 em 10/09 e compras 1000,00 em 3× em 20/09 vão para
 * as faturas de 10, 11 e 12 (333,33 + 333,33 + 333,34). Lazer 200,00 em 02/10 cai na fatura de 11.
 */
async function seed(family: Family) {
  return inFamily(family, async (tx) => {
    const ref = await refs(tx);
    const householdId = family.id;
    await tx.update(accounts).set({ openingBalance: "1000.00" }).where(eq(accounts.id, ref.main));
    const [usd] = await tx
      .insert(accounts)
      .values({ householdId, name: "Conta em dólar", currency: "USD", openingBalance: "200.00" })
      .returning({ id: accounts.id });
    const put2 = (line: Line) => put(tx, family, ref, line);

    await put2(receita("2025-12-05", "7000.00"));
    await put2({ on: "2025-12-08", amount: "1000.00", category: "Mercado" });

    const august = await put2(receita("2026-08-05", "8000.00"));
    await put2({ on: "2026-08-06", amount: "2000.00", category: "Moradia" });
    await put2({ on: "2026-08-08", amount: "900.00", category: "Mercado" });

    const september = await put2(receita("2026-09-05", "8000.00"));
    await put2(receita("2026-09-10", "500.00", "Trabalho autônomo"));
    await put2({ on: "2026-09-06", amount: "2000.00", category: "Moradia" });
    await put2({ on: "2026-09-08", amount: "1234.50", category: "Mercado" });
    const firstInstallment = await put2({
      on: "2026-09-05",
      amount: "1100.00",
      category: "Dívidas e empréstimos",
    });

    const october = await put2(receita("2026-10-05", "8200.00"));
    await put2({
      on: "2026-10-06",
      amount: "2000.00",
      category: "Moradia",
      description: "Aluguel",
    });
    await put2({ on: "2026-10-08", amount: "1100.25", category: "Mercado" });
    const statement = await put2({
      on: "2026-10-05",
      amount: "633.33",
      category: "Cartão de crédito",
    });
    const secondInstallment = await put2({
      on: "2026-10-05",
      amount: "1075.00",
      category: "Dívidas e empréstimos",
    });
    await put2({
      on: "2026-10-12",
      amount: "270.00",
      category: "Lazer",
      account: usd!.id,
      usd: { amount: "50.00", rate: "5.40000000" },
    });
    const goalPayment = await put2({
      on: "2026-10-07",
      amount: "500.00",
      category: "Metas e objetivos",
    });
    await put2({ on: "2026-10-20", amount: "150.00", category: "Saúde", status: "previsto" });

    await tx.insert(cashflowPlans).values({
      householdId,
      accountId: ref.main,
      categoryId: ref.category("Assinaturas"),
      kind: "despesa",
      description: "Academia",
      amount: "100.00",
      dayOfMonth: 15,
      startMonth: "2026-10",
    });

    const [income] = await tx
      .insert(incomeSources)
      .values({
        householdId,
        accountId: ref.main,
        categoryId: ref.category("Salário", "receita"),
        name: "Emprego",
        kind: "clt",
        amount: "8000.00",
        payDay: 5,
        startMonth: "2026-08",
      })
      .returning({ id: incomeSources.id });
    await tx.insert(incomeReceipts).values(
      [
        { month: "2026-08", transactionId: august },
        { month: "2026-09", transactionId: september },
        { month: "2026-10", transactionId: october },
      ].map((row) => ({
        householdId,
        incomeSourceId: income!.id,
        part: "salario" as const,
        ...row,
      })),
    );

    const [card] = await tx
      .insert(creditCards)
      .values({
        householdId,
        name: "Cartão azul",
        closingDay: 25,
        dueDay: 5,
        payingAccountId: ref.main,
      })
      .returning({ id: creditCards.id });
    await tx.insert(cardPurchases).values([
      {
        householdId,
        cardId: card!.id,
        categoryId: ref.category("Mercado"),
        description: "Atacado",
        amount: "300.00",
        purchasedOn: "2026-09-10",
      },
      {
        householdId,
        cardId: card!.id,
        categoryId: ref.category("Compras"),
        description: "Televisão",
        amount: "1000.00",
        installments: 3,
        purchasedOn: "2026-09-20",
      },
      {
        householdId,
        cardId: card!.id,
        categoryId: ref.category("Lazer"),
        description: "Show",
        amount: "200.00",
        purchasedOn: "2026-10-02",
      },
    ]);
    await tx.insert(cardStatementPayments).values({
      householdId,
      cardId: card!.id,
      statementMonth: "2026-10",
      transactionId: statement,
    });

    const [debt] = await tx
      .insert(debts)
      .values({
        householdId,
        accountId: ref.main,
        name: "Empréstimo do carro",
        system: "price",
        monthlyRate: "2.5000",
        originalBalance: "3000.00",
      })
      .returning({ id: debts.id });
    await tx.insert(debtInstallments).values([
      {
        householdId,
        debtId: debt!.id,
        number: 1,
        dueDate: "2026-09-05",
        amount: "1100.00",
        principal: "1000.00",
        interest: "100.00",
        transactionId: firstInstallment,
      },
      {
        householdId,
        debtId: debt!.id,
        number: 2,
        dueDate: "2026-10-05",
        amount: "1075.00",
        principal: "1000.00",
        interest: "75.00",
        transactionId: secondInstallment,
      },
      {
        householdId,
        debtId: debt!.id,
        number: 3,
        dueDate: "2026-11-05",
        amount: "1050.00",
        principal: "1000.00",
        interest: "50.00",
      },
    ]);

    const [fund, fixed] = await tx
      .insert(investments)
      .values([
        {
          householdId,
          name: "Fundo imobiliário",
          ticker: "PROV11",
          assetClass: "fii" as const,
          currentPrice: "110.00000000",
        },
        {
          householdId,
          name: "CDB",
          assetClass: "renda_fixa" as const,
          currentValue: "5500.00",
        },
      ])
      .returning({ id: investments.id });
    await tx.insert(investmentTrades).values([
      {
        householdId,
        investmentId: fund!.id,
        side: "compra",
        occurredOn: "2025-11-10",
        quantity: "100",
        unitPrice: "100",
        fees: "5.00",
      },
      {
        householdId,
        investmentId: fixed!.id,
        side: "compra",
        occurredOn: "2026-09-01",
        quantity: "1",
        unitPrice: "5000",
        fees: "0.00",
      },
      {
        householdId,
        investmentId: fund!.id,
        side: "venda",
        occurredOn: "2026-10-15",
        quantity: "10",
        unitPrice: "120",
        fees: "2.00",
      },
    ]);
    await tx.insert(investmentTargets).values([
      { householdId, assetClass: "fii", percent: "60" },
      { householdId, assetClass: "renda_fixa", percent: "40" },
    ]);
    const paid = (paidOn: string, gross: string, withheld = "0.00") => ({
      householdId,
      investmentId: fund!.id,
      kind: "rendimento" as const,
      paidOn,
      gross,
      withheld,
    });
    await tx
      .insert(dividends)
      .values([
        paid("2025-12-10", "40.00"),
        paid("2026-09-15", "95.00"),
        paid("2026-10-15", "99.00"),
        { ...paid("2026-10-20", "100.00", "15.00"), kind: "jcp" as const },
        { ...paid("2026-10-25", "10.00"), source: "agente" as const },
        paid("2026-12-15", "50.00"),
      ]);
    await tx.insert(dividendGoals).values({ householdId, monthlyAmount: "100.00" });

    await tx.insert(assets).values({
      householdId,
      name: "Carro",
      kind: "veiculo",
      value: "30000.00",
      valuedOn: "2026-10-01",
    });
    await tx.insert(netWorthSnapshots).values([
      { householdId, month: "2026-08", owned: "60000.00", owed: "5000.00", net: "55000.00" },
      { householdId, month: "2026-09", owned: "65000.00", owed: "4000.00", net: "61000.00" },
      { householdId, month: "2026-10", owned: "70000.00", owed: "3000.00", net: "67000.00" },
    ]);

    const [reform] = await tx
      .insert(goals)
      .values({
        householdId,
        name: "Reforma",
        kind: "reforma",
        targetAmount: "40000.00",
        saved: "12500.00",
        desiredMonth: "2027-10",
        planEnd: "2028-01",
        status: "juntando",
        accountId: ref.main,
      })
      .returning({ id: goals.id });
    await tx.insert(goals).values({
      householdId,
      name: "Notebook",
      kind: "compra",
      targetAmount: "5000.00",
      saved: "5000.00",
      status: "concluida",
      destinationAccountId: ref.main,
    });
    await tx.insert(goalContributions).values([
      {
        householdId,
        goalId: reform!.id,
        month: "2026-10",
        amount: "500.00",
        transactionId: goalPayment,
      },
      { householdId, goalId: reform!.id, month: "2026-11", amount: "500.00" },
    ]);

    const [titular, conjuge] = await tx
      .insert(people)
      .values([
        { householdId, name: "Titular", relation: "titular" as const },
        { householdId, name: "Parceira", relation: "conjuge" as const },
      ])
      .returning({ id: people.id });
    const [trip] = await tx
      .insert(trips)
      .values({ householdId, destination: "Lisboa", startOn: "2027-07-10", saved: "1000.00" })
      .returning({ id: trips.id });
    await tx.insert(tripCosts).values([
      { householdId, tripId: trip!.id, kind: "passagem", amount: "4500.00", perPerson: true },
      { householdId, tripId: trip!.id, kind: "hospedagem", amount: "3000.00" },
    ]);
    await tx.insert(tripPeople).values([
      { householdId, tripId: trip!.id, personId: titular!.id },
      { householdId, tripId: trip!.id, personId: conjuge!.id },
    ]);
    await tx.insert(retirementPlan).values({
      householdId,
      targetIncome: "10000.00",
      expectedYield: "8",
      monthlyContribution: "1000.00",
    });
    return { income: income!.id, card: card!.id, usd: usd!.id, fund: fund!.id, debt: debt!.id };
  });
}

afterAll(async () => {
  await db.closeAllPools();
});

describe("rodada real: dia 1 de novembro fecha outubro", () => {
  let family: Family;
  let usdRate: string;
  let firstRun: number;

  beforeAll(async () => {
    family = await newFamily();
    await seed(family);
    // `market_fx` é global e ninguém apaga: o teste lê a cotação que houver e não grava outra. Sem
    // cotação, a conta em dólar fica em zero, como em `accountBalances`.
    usdRate = await inFamily(family, async (tx) => (await db.latestFxRates(tx)).USD?.rate ?? "0");
    ({ applied: firstRun } = await run(family, "2026-11-01"));
  });

  it("gera os relatórios fechados do mês, do passado com data e do ano anterior", async () => {
    const rows = sorted(await all(family));
    expect(firstRun).toBe(rows.length);
    expect(rows.every((row) => row.status === "fechado")).toBe(true);
    // Dia 1 só fecha: o mês novo aparece no dia seguinte.
    expect(rows.some((row) => row.period === "2026-11" || row.period === "2026")).toBe(false);
    expect(
      rows
        .filter((row) => row.period === "2026-10")
        .map((row) => row.kind)
        .sort(),
    ).toEqual([
      "aposentadoria",
      "categorias",
      "dividas",
      "fluxo",
      "investimentos",
      "metas",
      "patrimonio",
      "proventos",
      "resumo",
    ]);
    expect(
      rows
        .filter((row) => row.period === "2026-09")
        .map((row) => row.kind)
        .sort(),
    ).toEqual(["categorias", "fluxo", "patrimonio", "proventos", "resumo"]);
    // Janeiro a julho sem lançamento não viram relatório vazio. Dezembro de 2025 tem.
    expect(rows.filter((row) => row.kind === "resumo").map((row) => row.period)).toEqual([
      "2025-12",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(rows.filter((row) => row.kind === "anual").map((row) => row.period)).toEqual(["2025"]);
  });

  it("resumo de outubro bate com os lançamentos", async () => {
    const { data, messageParams } = await read(family, "resumo", "2026-10");
    expect(data.asOf).toBe("2026-10-31");
    expect(figures(data)).toEqual({
      received: { money: "8200.00" },
      // A parcela de meta de 500,00 é dinheiro guardado, à parte (ADR-0027).
      spent: { money: "5078.58" },
      left: { money: "3121.42" },
      contributed: { money: "500.00" },
      afterContributions: { money: "2621.42" },
      // (6000,00 + 5100,00 + 4165,50) / 3 meses com movimento.
      average12: { money: "5088.50" },
    });
    expect(section(data, "comparison")).toEqual([
      // 8200 × 8500 = −3,53%; média (7000 + 8000 + 8500) / 3 = 7833,33, +4,68%.
      [
        { label: "entrou" },
        { money: "8200.00" },
        { money: "8500.00" },
        { percent: -4 },
        { money: "7833.33" },
        { percent: 5 },
      ],
      // 5078,58 × 4334,50 = +17,17%; média (1000 + 2900 + 4334,50) / 3 = 2744,83, +85,02%.
      [
        { label: "saiu" },
        { money: "5078.58" },
        { money: "4334.50" },
        { percent: 17 },
        { money: "2744.83" },
        { percent: 85 },
      ],
      // 3121,42 × 4165,50 = −25,06%; 3121,42 × 5088,50 = −38,66%.
      [
        { label: "sobrou" },
        { money: "3121.42" },
        { money: "4165.50" },
        { percent: -25 },
        { money: "5088.50" },
        { percent: -39 },
      ],
      // Sem aporte antes: não há base para variação.
      [
        { label: "aportado" },
        { money: "500.00" },
        { money: "0.00" },
        null,
        { money: "0.00" },
        null,
      ],
    ]);
    // A fatura paga abre nas compras: 633,33 não aparece como um gasto só.
    expect(section(data, "largest")).toEqual([
      [{ text: "Aluguel" }, { date: "2026-10-06" }, { money: "2000.00" }],
      [{ text: "Mercado" }, { date: "2026-10-08" }, { money: "1100.25" }],
      [{ text: "Dívidas e empréstimos" }, { date: "2026-10-05" }, { money: "1075.00" }],
      [{ text: "Televisão" }, { date: "2026-09-20" }, { money: "333.33" }],
      [{ text: "Atacado" }, { date: "2026-09-10" }, { money: "300.00" }],
    ]);
    const evolution = section(data, "evolution")!;
    expect(evolution).toHaveLength(11);
    expect(evolution[0]).toEqual([
      { month: "2025-12" },
      { money: "7000.00" },
      { money: "1000.00" },
      { money: "6000.00" },
      { money: "0.00" },
    ]);
    expect(evolution.at(-1)).toEqual([
      { month: "2026-10" },
      { money: "8200.00" },
      { money: "5078.58" },
      { money: "3121.42" },
      { money: "500.00" },
    ]);
    expect(messageParams).toEqual({
      received: { money: "8200.00" },
      spent: { money: "5078.58" },
      left: { money: "3121.42" },
    });
  });

  it("categorias de outubro: feito + previsto, com o cartão aberto por compra", async () => {
    const { data } = await read(family, "categorias", "2026-10");
    const ranking = section(data, "ranking")!;
    expect(
      ranking.map((row) => [(row[0] as { category: string }).category, row[1], row[2]]),
    ).toEqual([
      ["Moradia", { money: "2000.00" }, { percent: 37.5 }],
      ["Mercado", { money: "1400.25" }, { percent: 26.3 }],
      ["Dívidas e empréstimos", { money: "1075.00" }, { percent: 20.2 }],
      ["Compras", { money: "333.33" }, { percent: 6.3 }],
      ["Lazer", { money: "270.00" }, { percent: 5.1 }],
      ["Saúde", { money: "150.00" }, { percent: 2.8 }],
      ["Assinaturas", { money: "100.00" }, { percent: 1.9 }],
    ]);
    // 5078,58 feitos + 250,00 previstos; set/26 tem 4334,50: +22,93%.
    expect(figures(data)).toEqual({
      total: { money: "5328.58" },
      topCategory: { category: "Moradia" },
      change: { percent: 23 },
      contributed: { money: "500.00" },
    });
    expect(section(data, "savings")).toEqual([
      [{ category: "Metas e objetivos" }, { money: "500.00" }, { percent: 100 }],
    ]);
    expect(section(data, "up")!.map((row) => (row[3] as { money: string }).money)).toEqual([
      "333.33",
      "270.00",
      "165.75",
      "150.00",
      "100.00",
    ]);
    expect(section(data, "down")).toEqual([
      [
        { category: "Dívidas e empréstimos" },
        { money: "1075.00" },
        { money: "1100.00" },
        { money: "-25.00" },
      ],
    ]);
    expect(data.notes).toEqual(["incluiPrevisto", "aporteAParte"]);
  });

  it("fluxo de outubro: previsto × realizado e os três meses seguintes", async () => {
    const { data } = await read(family, "fluxo", "2026-10");
    // Previsto: renda 8000,00. Despesas: 100,00 + 633,33 + 1075,00 = 1808,33. Aporte: meta de 500,00.
    expect(section(data, "plannedActual")).toEqual([
      [{ label: "entrou" }, { money: "8000.00" }, { money: "8200.00" }, { money: "200.00" }],
      [{ label: "saiu" }, { money: "1808.33" }, { money: "5078.58" }, { money: "3270.25" }],
      [{ label: "sobrou" }, { money: "6191.67" }, { money: "3121.42" }, { money: "-3070.25" }],
      [{ label: "aportado" }, { money: "500.00" }, { money: "500.00" }, { money: "0.00" }],
    ]);
    expect(section(data, "projection")).toEqual([
      // Novembro: 100,00 + fatura 533,33 + parcela 1050,00; aporte: meta 500,00. O acumulado é o de antes.
      [
        { month: "2026-11" },
        { money: "8000.00" },
        { money: "1683.33" },
        { money: "6316.67" },
        { money: "500.00" },
        { money: "5816.67" },
      ],
      // Dezembro: 100,00 + fatura 333,34.
      [
        { month: "2026-12" },
        { money: "8000.00" },
        { money: "433.34" },
        { money: "7566.66" },
        { money: "0.00" },
        { money: "13383.33" },
      ],
      [
        { month: "2027-01" },
        { money: "8000.00" },
        { money: "100.00" },
        { money: "7900.00" },
        { money: "0.00" },
        { money: "21283.33" },
      ],
    ]);
    expect(figures(data)).toEqual({
      planned: { money: "6191.67" },
      left: { money: "3121.42" },
      open: { money: "-250.00" },
      projected: { money: "21283.33" },
    });
  });

  it("patrimônio de outubro, com a foto do dia 1 e a conta em dólar pela cotação", async () => {
    const { data } = await read(family, "patrimonio", "2026-10");
    // Conta principal: 1000 + 6000 + 5100 + 4165,50 + (2621,42 + 270,00, que saíram da conta em dólar).
    const main = domain.money("19156.92");
    // US$ 200 − US$ 50 = US$ 150 pela última cotação.
    const dollar = domain.money("150").times(usdRate).toDecimalPlaces(2);
    const contas = main.plus(dollar);
    // Bens 30000 + carteira 15400 + meta sem conta destino 12500.
    const owned = contas.plus("57900");
    // Dívida 1000,00 + faturas abertas 533,33 + 333,34.
    const net = owned.minus("1866.67");
    expect(figures(data)).toEqual({
      net: { money: net.toFixed(2) },
      owned: { money: owned.toFixed(2) },
      owed: { money: "1866.67" },
      change: { money: net.minus("61000").toFixed(2) },
    });
    expect(section(data, "assets")).toEqual([
      [{ label: "contas" }, { money: contas.toFixed(2) }],
      [{ label: "bens" }, { money: "30000.00" }],
      [{ label: "investimentos" }, { money: "15400.00" }],
      [{ label: "guardadoMetas" }, { money: "12500.00" }],
    ]);
    expect(section(data, "liabilities")).toEqual([
      [{ label: "dividas" }, { money: "1000.00" }],
      [{ label: "cartoes" }, { money: "866.67" }],
    ]);
    expect(data.notes).toEqual([]);
  });

  it("fluxo do passado não inventa um acumulado de zero para os meses seguintes", async () => {
    const { data } = await read(family, "fluxo", "2026-09");
    expect(figure(data, "projected")).toBeNull();
    expect(section(data, "projection")).toBeNull();
  });

  it("patrimônio do passado fica com a foto guardada, e a nota avisa", async () => {
    const { data } = await read(family, "patrimonio", "2026-09");
    expect(figures(data)).toEqual({
      net: { money: "61000.00" },
      owned: { money: "65000.00" },
      owed: { money: "4000.00" },
      change: { money: "6000.00" },
    });
    expect(data.notes).toEqual(["semDetalhe"]);
  });

  it("investimentos: posição, resultado por classe e operações do mês", async () => {
    const { data } = await read(family, "investimentos", "2026-10");
    // FII: 100 × 100 + 5 de taxa; vendeu 10 a 100,05 de custo médio; sobram 90 a 110,00 = 9900,00,
    // custo 9004,50. CDB: custo 5000,00, vale 5500,00. Carteira 15400,00, custo 14004,50, +9,96%.
    expect(figures(data)).toEqual({
      portfolio: { money: "15400.00" },
      gain: { money: "1395.50" },
      gainPercent: { percent: 10 },
      bought: { money: "0.00" },
      sold: { money: "1198.00" },
    });
    expect(section(data, "classes")).toEqual([
      [
        { label: "classe_fii" },
        { money: "9900.00" },
        { percent: 64.3 },
        { percent: 60 },
        { money: "-660.00" },
        { money: "895.50" },
      ],
      [
        { label: "classe_renda_fixa" },
        { money: "5500.00" },
        { percent: 35.7 },
        { percent: 40 },
        { money: "660.00" },
        { money: "500.00" },
      ],
    ]);
    const trades = section(data, "contributions")!;
    expect(trades).toHaveLength(12);
    expect(trades[0]).toEqual([{ month: "2025-11" }, { money: "10005.00" }, { money: "0.00" }]);
    expect(trades[10]).toEqual([{ month: "2026-09" }, { money: "5000.00" }, { money: "0.00" }]);
    expect(trades[11]).toEqual([{ month: "2026-10" }, { money: "0.00" }, { money: "1198.00" }]);
  });

  it("proventos: líquido, sem o que ainda vai cair", async () => {
    const { data } = await read(family, "proventos", "2026-10");
    // Outubro: 99,00 + (100,00 − 15,00) + 10,00. O de 15/12 ainda não caiu.
    expect(figures(data)).toEqual({
      month: { money: "194.00" },
      last12: { money: "329.00" },
      monthlyAverage: { money: "27.42" },
      thisYear: { money: "289.00" },
      withheld: { money: "15.00" },
      goalPercent: { percent: 27 },
    });
    expect(section(data, "byAsset")).toEqual([
      [{ text: "PROV11" }, { money: "329.00" }, { percent: 100 }],
    ]);
    // Dezembro repete o que caiu em dez/25. Nada mais tem base.
    expect(section(data, "forecast")).toEqual([[{ month: "2026-12" }, { money: "40.00" }]]);
  });

  it("dívidas: saldo só do que está em aberto e juros pela data do pagamento", async () => {
    const { data } = await read(family, "dividas", "2026-10");
    expect(section(data, "debts")).toEqual([
      [
        { text: "Empréstimo do carro" },
        { percent: 2.5 },
        { money: "1000.00" },
        { money: "75.00" },
        { count: 1 },
      ],
    ]);
    expect(figure(data, "balance")).toEqual({ money: "1000.00" });
    expect(figure(data, "interest")).toEqual({ money: "75.00" });
    expect(figure(data, "interest12")).toEqual({ money: "175.00" });
  });

  it("dívida arquivada não some dos juros pagos no mês", async () => {
    const other = await newFamily();
    const { debt } = await seed(other);
    await inFamily(other, (tx) =>
      tx.update(debts).set({ archived: true }).where(eq(debts.id, debt)),
    );
    await run(other, "2026-11-01");
    const { data } = await read(other, "dividas", "2026-10");
    expect(figure(data, "interest")).toEqual({ money: "75.00" });
    expect(figure(data, "interest12")).toEqual({ money: "175.00" });
    // Saldo aberto de dívida arquivada não conta, como no patrimônio.
    expect(figure(data, "balance")).toEqual({ money: "0.00" });
  });

  it("metas e viagens", async () => {
    const { data } = await read(family, "metas", "2026-10");
    expect(figures(data)).toEqual({
      saved: { money: "17500.00" },
      missing: { money: "27500.00" },
      onTime: { count: 1 },
      late: { count: 1 },
      trips: { count: 1 },
    });
    expect(section(data, "goals")![0]).toEqual([
      { text: "Reforma" },
      { label: "metaJuntando" },
      { money: "40000.00" },
      { money: "12500.00" },
      { percent: 31.2 },
      { month: "2027-10" },
      { month: "2028-01" },
      { label: "nao" },
    ]);
    // 2 × 4500,00 + 3000,00 = 12000,00; faltam 11000,00 em 8 meses.
    expect(section(data, "trips")).toEqual([
      [
        { text: "Lisboa" },
        { date: "2027-07-10" },
        { money: "12000.00" },
        { money: "1000.00" },
        { money: "11000.00" },
        { money: "1375.00" },
      ],
    ]);
  });

  it("aposentadoria: renda de hoje, carteira e o que falta", async () => {
    const { data } = await read(family, "aposentadoria", "2026-10");
    expect(figure(data, "currentIncome")).toEqual({ money: "27.42" });
    expect(figure(data, "portfolio")).toEqual({ money: "15400.00" });
    expect(figure(data, "contribution")).toEqual({ money: "1000.00" });
    expect(figure(data, "targetIncome")).toEqual({ money: "10000.00" });
    expect(figure(data, "targetYear")).toEqual({ year: 2040 });
    // Rende 329,00 / 9900,00 ao ano: 10000 × 12 × 9900 / 329 = 3.610.942,25.
    expect(figure(data, "requiredPortfolio")).toEqual({ money: "3610942.25" });
    expect(figure(data, "coverage")).toEqual({ percent: 0 });
  });

  it("ano anterior fecha com dezembro de 2025", async () => {
    const { data, status } = await read(family, "anual", "2025");
    expect(status).toBe("fechado");
    expect(data.asOf).toBe("2025-12-31");
    expect(figures(data)).toEqual({
      received: { money: "7000.00" },
      spent: { money: "1000.00" },
      left: { money: "6000.00" },
      contributed: { money: "0.00" },
      afterContributions: { money: "6000.00" },
      monthlyAverage: { money: "6000.00" },
      dividends: { money: "40.00" },
      interest: { money: "0.00" },
    });
  });

  it("a segunda rodada do dia não grava nada e não muda um campo", async () => {
    const before = sorted(await all(family));
    await expect(run(family, "2026-11-01")).resolves.toEqual({ suggestions: 0, applied: 0 });
    expect(sorted(await all(family))).toEqual(before);
  });

  it("mês fechado fica igual nos dias seguintes, e só o mês corrente muda", async () => {
    const closed = sorted(await all(family));
    await run(family, "2026-11-02");
    const after = await all(family);
    const same = sorted(after.filter((row) => row.status === "fechado"));
    expect(same).toEqual(closed);
    expect(after.filter((row) => row.status === "parcial").map((row) => row.period)).toContain(
      "2026",
    );
    await expect(run(family, "2026-11-02")).resolves.toEqual({ suggestions: 0, applied: 0 });
  });
});

describe("rodada real: ano e virada", () => {
  it("fecha 2026 em 1º de janeiro somando os doze meses", async () => {
    const family = await newFamily();
    const { income, card } = await seed(family);
    await run(family, "2026-11-01");
    await inFamily(family, async (tx) => {
      const ref = await refs(tx);
      const householdId = family.id;
      const line = (entry: Line) => put(tx, family, ref, entry);
      const salary = await line(receita("2026-11-05", "8000.00"));
      await line({ on: "2026-11-06", amount: "2000.00", category: "Moradia" });
      const november = await line({
        on: "2026-11-05",
        amount: "533.33",
        category: "Cartão de crédito",
      });
      const last = await line({
        on: "2026-11-05",
        amount: "1050.00",
        category: "Dívidas e empréstimos",
      });
      await tx
        .update(debtInstallments)
        .set({ transactionId: last })
        .where(eq(debtInstallments.number, 3));
      const salary2 = await line(receita("2026-12-05", "8000.00"));
      await line({ on: "2026-12-06", amount: "2000.00", category: "Moradia" });
      const december = await line({
        on: "2026-12-05",
        amount: "333.34",
        category: "Cartão de crédito",
      });
      await tx.insert(cardStatementPayments).values([
        { householdId, cardId: card, statementMonth: "2026-11", transactionId: november },
        { householdId, cardId: card, statementMonth: "2026-12", transactionId: december },
      ]);
      await tx.insert(incomeReceipts).values([
        {
          householdId,
          incomeSourceId: income,
          month: "2026-11",
          part: "salario",
          transactionId: salary,
        },
        {
          householdId,
          incomeSourceId: income,
          month: "2026-12",
          part: "salario",
          transactionId: salary2,
        },
      ]);
    });
    await run(family, "2026-12-20");
    expect((await read(family, "anual", "2026")).status).toBe("parcial");
    expect((await read(family, "resumo", "2026-12")).status).toBe("parcial");

    await run(family, "2027-01-01");
    const { data, status, closedAt } = await read(family, "anual", "2026");
    expect(status).toBe("fechado");
    expect(closedAt).not.toBeNull();
    expect(data.asOf).toBe("2026-12-31");
    // Entrou 8000 + 8500 + 8200 + 8000 + 8000. Saiu 2900,00 + 4334,50 + 5078,58 + 3583,33 + 2333,34,
    // sem a parcela de meta paga em outubro. A de novembro segue prevista, e o bloco de aportes a mostra.
    expect(figures(data)).toEqual({
      received: { money: "40700.00" },
      spent: { money: "18229.75" },
      left: { money: "22470.25" },
      contributed: { money: "500.00" },
      afterContributions: { money: "21970.25" },
      monthlyAverage: { money: "4494.05" },
      dividends: { money: "339.00" },
      interest: { money: "225.00" },
    });
    expect(section(data, "income")).toEqual([
      [{ category: "Salário" }, { money: "40200.00" }, { percent: 98.8 }],
      [{ category: "Trabalho autônomo" }, { money: "500.00" }, { percent: 1.2 }],
    ]);
    const ranking = section(data, "ranking")!.map((row) => [
      (row[0] as { category: string }).category,
      row[1],
    ]);
    expect(ranking).toEqual([
      ["Moradia", { money: "10000.00" }],
      ["Mercado", { money: "3534.75" }],
      ["Dívidas e empréstimos", { money: "3225.00" }],
      ["Compras", { money: "1000.00" }],
      ["Lazer", { money: "470.00" }],
      ["Assinaturas", { money: "300.00" }],
      ["Saúde", { money: "150.00" }],
    ]);
    expect(section(data, "byAsset")).toEqual([
      [{ text: "PROV11" }, { money: "354.00" }, { money: "15.00" }, { money: "339.00" }],
    ]);
    expect(data.sections.some((item) => item.id === "positions")).toBe(true);
    expect(section(data, "savings")).toEqual([
      [{ category: "Metas e objetivos" }, { money: "1000.00" }, { percent: 100 }],
    ]);
    expect(data.notes).toEqual(["anualNaoFiscal", "aporteAParte"]);
    // Dia 1 de janeiro só fecha: 2027 ainda não existe, e dezembro fechou junto.
    const rows = await all(family);
    expect(rows.some((row) => row.period.startsWith("2027"))).toBe(false);
    expect((await read(family, "resumo", "2026-12")).status).toBe("fechado");
    await expect(run(family, "2027-01-01")).resolves.toEqual({ suggestions: 0, applied: 0 });
    // Janeiro ainda sem movimento: o ano novo só aparece quando houver algo nele.
    await inFamily(family, async (tx) => {
      await put(tx, family, await refs(tx), {
        on: "2027-01-02",
        amount: "10.00",
        category: "Lazer",
      });
    });
    await run(family, "2027-01-02");
    expect((await read(family, "anual", "2027")).status).toBe("parcial");
    expect((await read(family, "resumo", "2027-01")).status).toBe("parcial");
  });

  it("fuso de Brasília decide o dia: 23h59 de 31/10 ainda não fecha, 00h00 de 01/11 fecha", async () => {
    const family = await newFamily({ timezone: "America/Sao_Paulo" });
    await seed(family);
    const dayAt = (instant: string) =>
      inFamily(family, async (tx) =>
        domain.todayIn(await db.householdTimezone(tx, family.id), new Date(instant)),
      );
    const before = await dayAt("2026-11-01T02:59:59Z");
    const after = await dayAt("2026-11-01T03:00:00Z");
    expect([before, after]).toEqual(["2026-10-31", "2026-11-01"]);

    await run(family, before);
    expect((await read(family, "resumo", "2026-10")).status).toBe("parcial");
    await run(family, after);
    expect((await read(family, "resumo", "2026-10")).status).toBe("fechado");
    expect((await read(family, "resumo", "2026-10")).data.asOf).toBe("2026-10-31");
  });

  it("janeiro em Brasília: 31/12 às 23h59 ainda é parcial; 01/01 às 00h00 fecha o ano", async () => {
    const family = await newFamily();
    await seed(family);
    await inFamily(family, async (tx) => {
      await put(tx, family, await refs(tx), {
        on: "2026-12-10",
        amount: "10.00",
        category: "Lazer",
      });
    });
    const days = ["2027-01-01T02:59:59Z", "2027-01-01T03:00:00Z"].map((instant) =>
      domain.todayIn("America/Sao_Paulo", new Date(instant)),
    );
    expect(days).toEqual(["2026-12-31", "2027-01-01"]);
    await run(family, days[0]!);
    expect((await read(family, "anual", "2026")).status).toBe("parcial");
    await run(family, days[1]!);
    expect((await read(family, "anual", "2026")).status).toBe("fechado");
  });

  it("perdeu o dia 1 de janeiro: o dia 2 fecha dezembro e o ano", async () => {
    const family = await newFamily();
    await seed(family);
    await inFamily(family, async (tx) => {
      await put(tx, family, await refs(tx), {
        on: "2026-12-10",
        amount: "10.00",
        category: "Lazer",
      });
    });
    await run(family, "2026-12-20");
    await run(family, "2027-01-02");
    expect((await read(family, "resumo", "2026-12")).status).toBe("fechado");
    expect((await read(family, "anual", "2026")).status).toBe("fechado");
  });

  it("fevereiro fecha no último dia certo, em ano comum e bissexto", async () => {
    const family = await newFamily();
    const add = (on: string) =>
      inFamily(family, async (tx) => {
        await put(tx, family, await refs(tx), { on, amount: "10.00", category: "Lazer" });
      });
    await add("2027-02-10");
    await add("2028-02-29");
    await run(family, "2027-03-01");
    expect((await read(family, "resumo", "2027-02")).data.asOf).toBe("2027-02-28");
    await run(family, "2028-03-01");
    const leap = await read(family, "resumo", "2028-02");
    expect(leap.data.asOf).toBe("2028-02-29");
    expect(figure(leap.data, "spent")).toEqual({ money: "10.00" });
  });
});

describe("rodada real: assinatura do mês fechado", () => {
  async function closed() {
    const family = await newFamily();
    const seeded = await seed(family);
    await run(family, "2026-11-01");
    return { family, ...seeded };
  }

  it("lançamento em mês fechado regenera os três que dependem dele e nada mais", async () => {
    const { family } = await closed();
    const before = sorted(await all(family));
    await inFamily(family, async (tx) => {
      await put(tx, family, await refs(tx), {
        on: "2026-10-30",
        amount: "100.00",
        category: "Lazer",
      });
    });
    await run(family, "2026-11-02");
    const after = await all(family);
    const closedAfter = sorted(after.filter((row) => row.status === "fechado"));
    const changed = closedAfter.filter(
      (row, index) => row.generatedAt.getTime() !== before[index]!.generatedAt.getTime(),
    );
    expect(changed.map(key)).toEqual(["categorias:2026-10", "fluxo:2026-10", "resumo:2026-10"]);
    for (const row of changed) {
      expect(row.revisedAt).not.toBeNull();
      expect(row.closedAt).toEqual(before.find((item) => key(item) === key(row))!.closedAt);
    }
    expect(figure(changed[2]!.data, "spent")).toEqual({ money: "5178.58" });
  });

  it("operação antiga reabre investimentos, mesmo dois meses depois", async () => {
    const { family, fund } = await closed();
    await run(family, "2026-12-01");
    const closedOctober = await read(family, "investimentos", "2026-10");
    await inFamily(family, (tx) =>
      tx.insert(investmentTrades).values({
        householdId: family.id,
        investmentId: fund,
        side: "compra",
        occurredOn: "2026-10-20",
        quantity: "1",
        unitPrice: "100",
        fees: "1.00",
      }),
    );
    await run(family, "2026-12-15");
    const revised = await read(family, "investimentos", "2026-10");
    expect(revised.revisedAt).not.toBeNull();
    expect(revised.closedAt).toEqual(closedOctober.closedAt);
    expect(figure(revised.data, "bought")).toEqual({ money: "101.00" });
  });

  it("parcela paga com data antiga reabre dívidas, mesmo dois meses depois", async () => {
    const { family, debt } = await closed();
    await run(family, "2026-12-01");
    await inFamily(family, async (tx) => {
      const id = await put(tx, family, await refs(tx), {
        on: "2026-10-28",
        amount: "1050.00",
        category: "Dívidas e empréstimos",
      });
      await tx
        .update(debtInstallments)
        .set({ transactionId: id })
        .where(and(eq(debtInstallments.debtId, debt), eq(debtInstallments.number, 3)));
    });
    await run(family, "2026-12-15");
    const revised = await read(family, "dividas", "2026-10");
    expect(revised.revisedAt).not.toBeNull();
    expect(figure(revised.data, "interest")).toEqual({ money: "125.00" });
  });

  it("agente mudar categoria e provento automático não reabrem", async () => {
    const family = await newFamily();
    const { fund } = await seed(family);
    const id = await inFamily(family, async (tx) =>
      put(tx, family, await refs(tx), {
        on: "2026-10-22",
        amount: "42.00",
        category: "Outras despesas",
        source: "importacao",
      }),
    );
    await run(family, "2026-11-01");
    const before = sorted(await all(family));
    await inFamily(family, async (tx) => {
      const ref = await refs(tx);
      await tx
        .update(transactions)
        .set({ categoryId: ref.category("Lazer"), categorySource: "agente" })
        .where(eq(transactions.id, id));
      await tx.insert(dividends).values({
        householdId: family.id,
        investmentId: fund,
        kind: "rendimento",
        paidOn: "2026-10-28",
        gross: "7.00",
        source: "agente",
      });
    });
    await run(family, "2026-11-20");
    const after = await all(family);
    expect(sorted(after.filter((row) => row.status === "fechado"))).toEqual(before);
  });

  it("família trocar para categoria específica reabre", async () => {
    const family = await newFamily();
    await seed(family);
    const id = await inFamily(family, async (tx) =>
      put(tx, family, await refs(tx), {
        on: "2026-10-22",
        amount: "42.00",
        category: "Outras despesas",
      }),
    );
    await run(family, "2026-11-01");
    await inFamily(family, async (tx) => {
      const ref = await refs(tx);
      await tx
        .update(transactions)
        .set({ categoryId: ref.category("Lazer"), categorySource: "familia" })
        .where(eq(transactions.id, id));
    });
    await run(family, "2026-11-20");
    const revised = await read(family, "categorias", "2026-10");
    expect(revised.revisedAt).not.toBeNull();
    expect(
      section(revised.data, "ranking")!.find(
        (row) => (row[0] as { category: string }).category === "Lazer",
      )?.[1],
    ).toEqual({ money: "312.00" });
  });

  it("cada mês conta só o que é dele: tudo volta a igualar o SQL direto", async () => {
    const { family } = await closed();
    const direct = await inFamily(family, async (tx) => {
      const rows = await tx.select().from(transactions);
      const savings = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.name, domain.GOAL_CATEGORY));
      const saved = new Set(savings.map((row) => row.id));
      const total = (month: string, kind: string, guarded: boolean) =>
        rows
          .filter(
            (row) =>
              row.occurredOn.startsWith(month) &&
              row.kind === kind &&
              row.status === "realizado" &&
              saved.has(row.categoryId) === guarded,
          )
          .reduce((acc, row) => acc.plus(row.amount), domain.money(0))
          .toFixed(2);
      return ["2026-08", "2026-09", "2026-10"].map((month) => ({
        month,
        received: total(month, "receita", false),
        spent: total(month, "despesa", false),
        contributed: total(month, "despesa", true),
      }));
    });
    for (const { month, received, spent, contributed } of direct) {
      const { data } = await read(family, "resumo", month);
      expect(figure(data, "received")).toEqual({ money: received });
      expect(figure(data, "spent")).toEqual({ money: spent });
      expect(figure(data, "contributed")).toEqual({ money: contributed });
    }
  });
});

describe("rodada real: família em dólar", () => {
  it("salário bruto em dólar não leva desconto do Brasil no previsto do fluxo", async () => {
    const family = await newFamily({ mainCurrency: "USD" });
    await inFamily(family, async (tx) => {
      const ref = await refs(tx);
      await tx.insert(incomeSources).values({
        householdId: family.id,
        accountId: ref.main,
        categoryId: ref.category("Salário", "receita"),
        name: "Job",
        kind: "clt",
        amount: "10000.00",
        isGross: true,
        payDay: 5,
        startMonth: "2026-08",
      });
      await put(tx, family, ref, { on: "2026-10-06", amount: "2000.00", category: "Moradia" });
    });
    await run(family, "2026-11-01");
    await expect(inFamily(family, (tx) => agents.householdCurrency(tx, family.id))).resolves.toBe(
      "USD",
    );
    const { data } = await read(family, "fluxo", "2026-10");
    expect(section(data, "plannedActual")![0]![1]).toEqual({ money: "10000.00" });
    // Mesma régua do fluxo do painel: previsto de renda de novembro é o valor informado.
    expect(section(data, "projection")![0]![1]).toEqual({ money: "10000.00" });
  });

  it("conta em real de família em dólar entra na moeda da família", async () => {
    const family = await newFamily({ mainCurrency: "USD" });
    await inFamily(family, async (tx) => {
      const ref = await refs(tx);
      const [brl] = await tx
        .insert(accounts)
        .values({ householdId: family.id, name: "Conta no Brasil", currency: "BRL" })
        .returning({ id: accounts.id });
      await tx.insert(transactions).values({
        householdId: family.id,
        accountId: brl!.id,
        categoryId: ref.category("Mercado"),
        kind: "despesa",
        description: "Mercado no Brasil",
        amount: "20.00",
        brlAmount: "110.00",
        brlRate: "0.18181818",
        occurredOn: "2026-10-06",
        categorySource: "familia",
      });
    });
    await run(family, "2026-11-01");
    const { data } = await read(family, "resumo", "2026-10");
    expect(figure(data, "spent")).toEqual({ money: "20.00" });
  });
});
