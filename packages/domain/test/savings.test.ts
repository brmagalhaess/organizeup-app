// Aporte fora de "Despesas" (ADR-0027). A conta que não pode falhar: mudar de lugar não perde centavo.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  activityByAccount,
  buildAnual,
  buildCategorias,
  buildMonthEntries,
  buildResumo,
  CONTRIBUTION_CATEGORY,
  contributionLines,
  essentialBaseline,
  essentialSpending,
  expenseLines,
  foldCategories,
  GOAL_CATEGORY,
  hasAnything,
  incomeLines,
  largestExpenses,
  money,
  monthlyPlan,
  NO_SAVINGS,
  planDividendRetirement,
  plannedNetByAccount,
  savingsCategory,
  savingsDestination,
  savingsRule,
  splitCardSavings,
  spendingByCategory,
  suggestAllocation,
  summarizeMonth,
  toDbAmount,
  entryFlow,
  type MonthEntry,
  type TransactionInput,
} from "../src";

const rule = savingsRule({
  categories: [
    { id: "aportes", name: CONTRIBUTION_CATEGORY, kind: "despesa", position: 91 },
    { id: "metas", name: GOAL_CATEGORY, kind: "despesa", position: 90 },
    { id: "metas-r", name: GOAL_CATEGORY, kind: "receita", position: 90 },
    { id: "mercado", name: "Mercado", kind: "despesa", position: 2 },
  ],
  tradeTransactionIds: ["operacao", null],
  goalTransactionIds: ["parcela", null],
});

const tx = (over: Partial<TransactionInput> = {}): TransactionInput => ({
  id: "t1",
  kind: "despesa",
  description: "Lançamento",
  amount: "100.00",
  occurredOn: "2026-10-10",
  status: "realizado",
  categoryId: "mercado",
  accountId: "a1",
  planId: null,
  planMonth: null,
  ...over,
});

describe("o que é dinheiro guardado", () => {
  it("reconhece a categoria pelo modelo, mesmo renomeada, traduzida ou em outro idioma", () => {
    for (const name of ["Investimentos", "Investments", "Inversiones", "Minha poupança"]) {
      expect(savingsCategory({ name, kind: "despesa", position: 91 })).toBe("investimento");
      expect(savingsCategory({ name, kind: "despesa", position: 90 })).toBe("meta");
      expect(savingsCategory({ name, kind: "receita", position: 90 })).toBe("meta");
    }
  });

  it("reconhece pelo nome de sistema a categoria criada sem o modelo, sem caixa nem acento", () => {
    const row = (name: string, kind: "despesa" | "receita" = "despesa") => ({
      name,
      kind,
      position: 100,
    });
    expect(savingsCategory(row("aportes e investimentos"))).toBe("investimento");
    expect(savingsCategory(row(CONTRIBUTION_CATEGORY, "receita"))).toBe("investimento");
    expect(savingsCategory(row("METAS E OBJETIVOS"))).toBe("meta");
  });

  it("categoria da família com nome parecido não vira aporte", () => {
    for (const name of ["Investimentos", "Aportes", "Meta de viagem", "Corretora"]) {
      expect(savingsCategory({ name, kind: "despesa", position: 100 })).toBeNull();
    }
    expect(savingsCategory({ name: "Mercado", kind: "despesa", position: 2 })).toBeNull();
    // Só existe modelo de aporte em despesa: receita com a posição 91 não é dele.
    expect(savingsCategory({ name: "Outra", kind: "receita", position: 91 })).toBeNull();
  });

  it("lançamento de operação é aporte mesmo fora da categoria, e o de meta, parcela de meta", () => {
    expect(savingsDestination({ id: "operacao", categoryId: "mercado" }, rule)).toBe(
      "investimento",
    );
    expect(savingsDestination({ id: "parcela", categoryId: "mercado" }, rule)).toBe("meta");
    expect(savingsDestination({ categoryId: "", source: "meta" }, rule)).toBe("meta");
    expect(savingsDestination({ id: "outro", categoryId: "mercado" }, rule)).toBeNull();
  });

  it("os quatro fluxos", () => {
    expect(entryFlow({ kind: "despesa", categoryId: "aportes" }, rule)).toBe("aporte");
    expect(entryFlow({ kind: "receita", categoryId: "metas-r" }, rule)).toBe("resgate");
    expect(entryFlow({ kind: "despesa", categoryId: "mercado" }, rule)).toBe("despesa");
    expect(entryFlow({ kind: "receita", categoryId: "salario" }, rule)).toBe("receita");
  });
});

describe("resumo do mês", () => {
  const rows = [
    tx({ id: "s", kind: "receita", categoryId: "salario", amount: "5000.00" }),
    tx({ id: "m", amount: "1200.50" }),
    tx({ id: "operacao", amount: "1000.00", categoryId: "aportes" }),
    tx({ id: "v", kind: "receita", amount: "300.00", categoryId: "aportes" }),
    tx({ id: "p", amount: "200.00", categoryId: "aportes", status: "previsto" }),
  ];
  const entries = buildMonthEntries("2026-10", [], rows);

  it("separa receita, despesa, aporte e resgate, e sobra depois de aportar é resultado menos aporte", () => {
    expect(summarizeMonth(entries, rule)).toMatchObject({
      received: "5000.00",
      spent: "1200.50",
      balance: "3799.50",
      contributed: "1000.00",
      redeemed: "300.00",
      afterContributions: "2799.50",
      plannedContribution: "200.00",
      projectedBalance: "3799.50",
    });
  });

  it("categorias de despesa e de receita fecham sem aporte, que ganha a própria lista", () => {
    expect(spendingByCategory(entries, [], undefined, rule)).toEqual([
      { categoryId: "mercado", amount: "1200.50" },
    ]);
    expect(incomeLines(entries, rule).map((row) => row.categoryId)).toEqual(["salario"]);
    expect(contributionLines(entries, rule)).toEqual([
      { categoryId: "aportes", amount: "1200.00", done: "1000.00", planned: "200.00" },
    ]);
  });

  it("maior gasto nunca é um aporte", () => {
    const largest = largestExpenses(entries, [], undefined, rule);
    expect(largest.map((row) => row.amount)).toEqual(["1200.50"]);
  });

  it("aporte previsto não some do mês: previsto também é movimento", () => {
    const future = buildMonthEntries(
      "2026-10",
      [],
      [tx({ categoryId: "aportes", status: "previsto" })],
    );
    expect(hasAnything(summarizeMonth(future, rule))).toBe(true);
  });
});

const entryArb = fc.record({
  cents: fc.integer({ min: 1, max: 5_000_000 }),
  income: fc.boolean(),
  done: fc.boolean(),
  account: fc.constantFrom("a1", "a2"),
  category: fc.constantFrom("mercado", "aportes", "metas", "metas-r", "salario", "cartao"),
  linked: fc.constantFrom(null, "operacao", "parcela"),
});

const lineArb = fc.record({
  cents: fc.integer({ min: 1, max: 500_000 }),
  category: fc.constantFrom("mercado", "aportes"),
});

const toEntries = (rows: Array<fc.Arbitrary<never> | Record<string, unknown>>) =>
  buildMonthEntries(
    "2026-10",
    [],
    (rows as Array<ReturnType<typeof entryArb.generate>["value"]>).map((row, index) =>
      tx({
        id: row.linked ? `${row.linked}${index}` : `t${index}`,
        amount: toDbAmount(money(row.cents).dividedBy(100)),
        kind: row.income ? "receita" : "despesa",
        status: row.done ? "realizado" : "previsto",
        accountId: row.account,
        categoryId: row.category,
      }),
    ),
  );

const add = (...values: string[]) =>
  toDbAmount(values.reduce((acc, value) => acc.plus(value), money(0)));

describe("sem perda de centavo, para qualquer família", () => {
  it("despesa + aportes é a saída total de antes, e receita + resgates, a entrada", () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 40 }), (rows) => {
        const entries = toEntries(rows);
        const before = summarizeMonth(entries, NO_SAVINGS);
        const after = summarizeMonth(entries, rule);
        expect(add(after.spent, after.contributed)).toBe(before.spent);
        expect(add(after.received, after.redeemed)).toBe(before.received);
        expect(add(after.plannedExpense, after.plannedContribution)).toBe(before.plannedExpense);
        expect(add(after.plannedIncome, after.plannedRedemption)).toBe(before.plannedIncome);
      }),
    );
  });

  it("o saldo previsto de cada conta é o mesmo de antes, centavo por centavo", () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 40 }), (rows) => {
        const entries = toEntries(rows);
        const before = plannedNetByAccount([activityByAccount(entries, NO_SAVINGS)]);
        const after = plannedNetByAccount([activityByAccount(entries, rule)]);
        for (const [id, value] of before) expect(after.get(id)?.eq(value)).toBe(true);
      }),
    );
  });

  it("por conta soma o total, e por categoria fecha nos totais", () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 40 }), (rows) => {
        const entries = toEntries(rows);
        const summary = summarizeMonth(entries, rule);
        const accounts = [...activityByAccount(entries, rule).values()];
        expect(add(...accounts.map((row) => row.contributed))).toBe(summary.contributed);
        expect(add(...accounts.map((row) => row.spent))).toBe(summary.spent);
        expect(foldCategories(contributionLines(entries, rule)).total).toBe(
          add(summary.contributed, summary.plannedContribution),
        );
        expect(foldCategories(incomeLines(entries, rule)).total).toBe(
          add(summary.received, summary.plannedIncome),
        );
      }),
    );
  });

  it("compra de aporte no cartão sai da fatura sem mudar o total", () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1, maxLength: 8 }), (rows) => {
        const lines = rows.map((row) => ({
          cardId: "c1",
          categoryId: row.category,
          amount: toDbAmount(money(row.cents).dividedBy(100)),
        }));
        const total = add(...lines.map((line) => line.amount));
        const fatura: MonthEntry = {
          key: "f:c1:2026-10",
          source: "fatura",
          id: "c1",
          kind: "despesa",
          description: "Fatura",
          amount: total,
          date: "2026-10-10",
          status: "previsto",
          categoryId: "cartao",
          accountId: "a1",
          recurring: false,
        };
        const paid: MonthEntry = {
          ...fatura,
          key: "t:pago",
          source: "lancamento",
          id: "pago",
          status: "realizado",
        };
        for (const entry of [fatura, paid]) {
          const split = splitCardSavings([entry], lines, "cartao", rule);
          const summary = summarizeMonth(split, rule);
          const aportes = add(
            ...lines.filter((line) => line.categoryId === "aportes").map((line) => line.amount),
          );
          const spent = add(summary.spent, summary.plannedExpense);
          const contributed = add(summary.contributed, summary.plannedContribution);
          expect(contributed).toBe(aportes);
          expect(add(spent, contributed)).toBe(total);
          expect(foldCategories(expenseLines(split, lines, "cartao", rule)).total).toBe(spent);
        }
      }),
    );
  });
});

describe("relatórios", () => {
  const summary = (entries: MonthEntry[]) => summarizeMonth(entries, rule);
  const aporte = buildMonthEntries("2026-10", [], [tx({ categoryId: "aportes" })]);

  it("mês só com aporte continua tendo relatório", () => {
    const resumo = buildResumo({
      month: "2026-10",
      asOf: "2026-10-31",
      summary: summary(aporte),
      previous: summary([]),
      history: [],
      largest: [],
    });
    expect(resumo?.data.version).toBe(2);
    expect(resumo?.data.notes).toContain("aporteAParte");
    const categorias = buildCategorias({
      month: "2026-10",
      asOf: "2026-10-31",
      byCategory: [],
      contributions: [{ categoryId: "aportes", amount: "100.00" }],
      previous: [],
      names: new Map([["aportes", CONTRIBUTION_CATEGORY]]),
      evolution: [],
    });
    expect(categorias?.data.figures.map((figure) => figure.id)).toEqual(["total", "contributed"]);
    const anual = buildAnual({
      year: "2026",
      asOf: "2026-10-31",
      months: [
        {
          month: "2026-10",
          received: "0.00",
          spent: "0.00",
          balance: "0.00",
          contributed: "100.00",
          redeemed: "0.00",
        },
      ],
      expenses: [],
      incomes: [],
      contributions: [{ categoryId: "aportes", amount: "100.00" }],
      names: new Map(),
      dividends: [],
      interestPaid: "0.00",
      positions: null,
    });
    expect(anual?.data.figures.find((figure) => figure.id === "afterContributions")?.value).toEqual(
      {
        money: "-100.00",
      },
    );
  });
});

describe("divisão do excedente", () => {
  const base = {
    available: "3600.00",
    reserveMissing: "90000.00",
    expensiveDebtBalance: "0.00",
    retirementRequired: "5000.00",
    confirmedTripsMonthly: "0.00",
  };
  const partsOf = (a: ReturnType<typeof suggestAllocation>) =>
    add(a.reserve, a.debt, a.retirement, a.goalsBudget, a.tripsBudget, a.tripsCommitted);

  it("sem aporte, é a divisão de sempre", () => {
    expect(suggestAllocation(base)).toMatchObject({
      reserve: "1800.00",
      retirement: "1260.00",
      alreadyInvesting: "0.00",
      goalsBudget: "270.00",
      tripsBudget: "270.00",
    });
  });

  it("aporte que cabe na fatia da aposentadoria não muda nada", () => {
    expect(suggestAllocation({ ...base, alreadyInvesting: "1000.00" })).toMatchObject({
      reserve: "1800.00",
      retirement: "1260.00",
      alreadyInvesting: "1000.00",
      goalsBudget: "270.00",
    });
  });

  it("quem segue a sugestão recebe a mesma sugestão no mês seguinte", () => {
    const first = suggestAllocation(base);
    const next = suggestAllocation({ ...base, alreadyInvesting: first.retirement });
    expect({ ...next, alreadyInvesting: "0.00", notes: [] }).toEqual({ ...first, notes: [] });
  });

  it("o que passa da fatia sai de metas e viagens antes de tocar na reserva", () => {
    expect(suggestAllocation({ ...base, alreadyInvesting: "1500.00" })).toMatchObject({
      reserve: "1800.00",
      retirement: "1500.00",
      goalsBudget: "150.00",
      tripsBudget: "150.00",
    });
    expect(suggestAllocation({ ...base, alreadyInvesting: "3000.00" })).toMatchObject({
      reserve: "600.00",
      retirement: "3000.00",
      goalsBudget: "0.00",
      tripsBudget: "0.00",
    });
  });

  it("nada é dividido duas vezes, e o aporte nunca passa do disponível", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000 }),
        fc.integer({ min: 0, max: 2_000_000 }),
        fc.integer({ min: 0, max: 2_000_000 }),
        fc.integer({ min: 0, max: 2_000_000 }),
        fc.boolean(),
        (available, invested, missing, debt, withPlan) => {
          const cents = (value: number) => toDbAmount(money(value).dividedBy(100));
          const allocation = suggestAllocation({
            ...base,
            available: cents(available),
            alreadyInvesting: cents(invested),
            reserveMissing: cents(missing),
            expensiveDebtBalance: cents(debt),
            retirementRequired: withPlan ? "5000.00" : null,
          });
          expect(partsOf(allocation)).toBe(cents(available));
          expect(money(allocation.alreadyInvesting).lte(cents(available))).toBe(true);
          expect(money(allocation.retirement).gte(allocation.alreadyInvesting)).toBe(true);
        },
      ),
    );
  });

  it("o plano do mês não pede para guardar o que já é guardado", () => {
    const input = {
      today: "2026-11-02",
      targetYear: 2050,
      targetIncome: "10000.00",
      essentialMonthly: "3000.00",
      averageExpenses12: "6000.00",
      pensions: [],
      assets: [
        {
          id: "a",
          assetClass: "fii",
          value: "100000.00",
          dividendsNet12: "8000.00",
          monthsHeld: 24,
          firstDividendOn: null,
        },
      ],
      expectedYield: null,
      dividendGrowth: "0",
      contribution: "500.00",
    };
    const plan = planDividendRetirement(input);
    const actions = monthlyPlan({
      base: input,
      plan,
      contribution: "500.00",
      allocation: {
        reserve: "0.00",
        debt: "0.00",
        retirement: "3000.00",
        alreadyInvesting: "3000.00",
      },
      largestCategory: null,
    });
    expect(actions.find((action) => action.kind === "guardar")?.amount).toBe("100.00");
  });
});

describe("reserva", () => {
  const essential = new Set(["mercado", "aportes"]);

  it("aporte não entra no gasto essencial, nem marcado como essencial", () => {
    const rows = [tx({ amount: "2000.00" }), tx({ id: "b", categoryId: "aportes" })];
    const lines = [
      { categoryId: "aportes", amount: "40.00" },
      { categoryId: "mercado", amount: "60.00" },
    ];
    expect(essentialSpending(rows, lines, essential, rule)).toBe("2060.00");
  });

  it("média ignora mês em que só houve aporte: a reserva não encolhe por isso", () => {
    const months = [
      [tx({ amount: "3000.00" })],
      [tx({ amount: "3000.00" })],
      [tx({ id: "b", amount: "5000.00", categoryId: "aportes" })],
    ].map((rows) => essentialSpending(rows, [], essential, rule));
    expect(essentialBaseline(months, "0.00", null)).toEqual({
      monthly: "3000.00",
      basis: "media",
      months: 2,
    });
  });

  it("o gasto que a família informou não muda", () => {
    expect(essentialBaseline(["1.00"], "0.00", "4500.00")).toEqual({
      monthly: "4500.00",
      basis: "informado",
      months: 0,
    });
  });
});
