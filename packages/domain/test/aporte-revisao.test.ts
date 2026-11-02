// O que a revisão independente do ADR-0027 achou. Cada caso falhava antes da correção.
import { describe, expect, it } from "vitest";
import {
  availableToAllocate,
  buildFluxo,
  buildMonthEntries,
  categorizeRow,
  CONTRIBUTION_CATEGORY,
  GOAL_CATEGORY,
  importedRedemptionGroups,
  money,
  monthlyPlan,
  monthlySeries,
  monthlySurplus,
  NO_SAVINGS,
  planDividendRetirement,
  savedByMonth,
  savingHabit,
  savingsRule,
  suggestAllocation,
  summarizeMonth,
  toDbAmount,
  type MonthPoint,
  type TransactionInput,
} from "../src";

const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

const rule = savingsRule({
  categories: [
    { id: "ap", name: CONTRIBUTION_CATEGORY, kind: "despesa", position: 91 },
    { id: "ap-r", name: CONTRIBUTION_CATEGORY, kind: "receita", position: 100 },
    { id: "me", name: GOAL_CATEGORY, kind: "despesa", position: 90 },
    { id: "me-r", name: GOAL_CATEGORY, kind: "receita", position: 90 },
    { id: "ca", name: "Cartão de crédito", kind: "despesa", position: 11 },
    { id: "su", name: "Mercado", kind: "despesa", position: 2 },
    { id: "sa", name: "Salário", kind: "receita", position: 1 },
  ],
  tradeTransactionIds: [],
  goalTransactionIds: [],
});

const tx = (
  id: string,
  month: string,
  kind: "receita" | "despesa",
  categoryId: string,
  amount: string,
) =>
  ({
    id: `${id}${month}`,
    kind,
    description: id,
    amount,
    occurredOn: `${month}-10`,
    status: "realizado",
    categoryId,
    accountId: "a",
    planId: null,
    planMonth: null,
  }) satisfies TransactionInput;

const sum = (...values: string[]) =>
  toDbAmount(values.reduce((acc, value) => acc.plus(value), money(0)));

describe("1. aporte no cartão", () => {
  const rows = MONTHS.flatMap((m) => [
    tx("s", m, "receita", "sa", "10000.00"),
    tx("m", m, "despesa", "su", "6000.00"),
    tx("f", m, "despesa", "ca", "3000.00"),
  ]);
  const lines = MONTHS.map((m) => ({
    cardId: "k",
    categoryId: "ap",
    amount: "3000.00",
    statementMonth: m,
  }));
  const cards = { lines, categoryId: "ca" };

  it("o hábito vem da mesma entrada dividida do excedente, e bate com o aportado", () => {
    const points = monthlySeries(MONTHS, [], rows, rule, cards);
    expect(points.at(-1)).toMatchObject({ spent: "6000.00", contributed: "3000.00" });
    const saved = savedByMonth(MONTHS, rows, rule, cards);
    expect(saved.map((month) => month.invested)).toEqual(MONTHS.map(() => "3000.00"));
    expect(
      savingHabit(
        saved.map((month) => month.invested),
        points,
      ),
    ).toBe("3000.00");
  });

  it("salário 10.000, mercado 6.000 e 3.000 de aporte no cartão: nada além de 1.000 é repartido", () => {
    const points = monthlySeries(MONTHS, [], rows, rule, cards);
    const saved = savedByMonth(MONTHS, rows, rule, cards);
    const allocation = suggestAllocation({
      available: availableToAllocate(monthlySurplus(points).usable),
      reserveMissing: "30000.00",
      expensiveDebtBalance: "0.00",
      retirementRequired: "2000.00",
      confirmedTripsMonthly: "0.00",
      alreadyInvesting: savingHabit(
        saved.map((month) => month.invested),
        points,
      ),
    });
    const beyondHabit = sum(
      allocation.reserve,
      allocation.debt,
      toDbAmount(money(allocation.retirement).minus(allocation.alreadyInvesting)),
      allocation.goalsBudget,
      allocation.tripsBudget,
      allocation.tripsCommitted,
    );
    expect(money(beyondHabit).lte("1000.00")).toBe(true);
  });
});

describe("2. extrato importado", () => {
  const options = [
    { id: "ap", name: CONTRIBUTION_CATEGORY, kind: "despesa" as const },
    { id: "ap-r", name: CONTRIBUTION_CATEGORY, kind: "receita" as const },
    { id: "or", name: "Outras receitas", kind: "receita" as const },
  ];
  const memory = { history: new Map(), learned: new Map() };

  it.each([
    "RESGATE CDB",
    "RES APLIC AUT MAIS",
    "RESG AUT FUNDO",
    "RESGATE POUPANCA",
    "RESGATE TESOURO DIRETO",
    "RESGATE LCI",
    "RESGATE LCA",
    "RESGATE RDB",
    "RESGATE PREVIDENCIA",
    "RESGATE APLICACAO",
  ])("%s vai para a categoria de aportes, como receita", (description) => {
    const proposal = categorizeRow({ description, kind: "receita" }, options, memory);
    expect(proposal).toMatchObject({ categoryId: "ap-r", source: "palavra" });
  });

  it.each([
    "RESGATE FGTS",
    "RESGATE FUNDO DE GARANTIA",
    "RESGATE PONTOS LIVELO",
    "RESGATE SEGURO",
    "RESGATE CONSORCIO",
    "RESGATE PREMIO",
    "RESGATE CAPITALIZACAO",
    "RESGATE AUTOMATICO",
    "RESGATE",
  ])("%s não é resgate de aplicação", (description) => {
    const proposal = categorizeRow({ description, kind: "receita" }, options, memory);
    expect(proposal.categoryId).not.toBe("ap-r");
    expect(proposal.newCategory?.name).not.toBe(CONTRIBUTION_CATEGORY);
  });

  it("sem a categoria de receita, propõe criá-la com o nome de sistema", () => {
    const proposal = categorizeRow(
      { description: "RESGATE CDB", kind: "receita" },
      options.slice(2),
      memory,
    );
    expect(proposal.newCategory?.name).toBe(CONTRIBUTION_CATEGORY);
  });

  it("resgate e aplicação automáticos no mesmo valor dão hábito líquido zero", () => {
    const rows = MONTHS.flatMap((m) => [
      tx("s", m, "receita", "sa", "10000.00"),
      tx("m", m, "despesa", "su", "6000.00"),
      tx("a", m, "despesa", "ap", "5000.00"),
      tx("r", m, "receita", "ap-r", "5000.00"),
    ]);
    const points = monthlySeries(MONTHS, [], rows, rule);
    const saved = savedByMonth(MONTHS, rows, rule);
    expect(saved.map((month) => month.invested)).toEqual(MONTHS.map(() => "0.00"));
    expect(
      savingHabit(
        saved.map((month) => month.invested),
        points,
      ),
    ).toBe("0.00");
    expect(monthlySurplus(points).usable).toBe("4000.00");
  });

  const row = (over: Partial<Parameters<typeof importedRedemptionGroups>[0][number]>) => ({
    id: "t",
    kind: "receita" as const,
    description: "RESGATE CDB",
    categoryId: "or",
    categoryName: "Outras receitas",
    categorySource: "revisar" as const,
    importBatchId: "lote",
    ...over,
  });

  it("no histórico, só categoria genérica vinda da importação", () => {
    const groups = importedRedemptionGroups(
      [
        row({ id: "ok" }),
        row({ id: "ok2", description: "RES APLIC AUT MAIS" }),
        row({ id: "manual", importBatchId: null }),
        row({ id: "escolhida", categoryId: "x", categoryName: "Bônus", categorySource: "familia" }),
        row({ id: "salario", description: "SALARIO EMPRESA" }),
        row({ id: "fgts", description: "RESGATE FGTS" }),
        row({ id: "pontos", description: "RESGATE PONTOS" }),
        row({ id: "despesa", kind: "despesa", categoryName: "Outras despesas" }),
      ],
      new Set(),
    );
    expect(groups.flatMap((group) => group.ids).sort()).toEqual(["ok", "ok2"]);
    expect(groups.find((group) => group.ids.includes("ok"))).toMatchObject({
      merchant: "resgate cdb",
      fromCategoryId: "or",
    });
  });

  it("o que a família desfez não volta", () => {
    expect(importedRedemptionGroups([row({})], new Set(["receita:resgate cdb"]))).toEqual([]);
  });
});

describe("F1. o hábito não passa à frente de reserva e dívida", () => {
  const base = {
    available: "3000.00",
    reserveMissing: "30000.00",
    expensiveDebtBalance: "0.00",
    retirementRequired: "2000.00",
    confirmedTripsMonthly: "0.00",
  };

  it("sem reserva e aportando tudo: nada é prometido, e a nota diz por quê", () => {
    const allocation = suggestAllocation({ ...base, alreadyInvesting: "3000.00" });
    expect(allocation).toMatchObject({
      reserve: "0.00",
      retirement: "3000.00",
      goalsBudget: "0.00",
      tripsBudget: "0.00",
      reserveShort: "1500.00",
      debtShort: "0.00",
      redirectable: "1500.00",
    });
    expect(allocation.notes.join(" ")).toMatch(/só cabem R\$\s0,00/);
    expect(allocation.notes.join(" ")).not.toContain("Primeiro a reserva");
  });

  it("dívida cara fica curta do mesmo jeito", () => {
    const allocation = suggestAllocation({
      ...base,
      reserveMissing: "0.00",
      expensiveDebtBalance: "20000.00",
      alreadyInvesting: "3000.00",
    });
    expect(allocation).toMatchObject({
      debt: "0.00",
      debtShort: "2100.00",
      redirectable: "2100.00",
    });
    expect(allocation.notes.join(" ")).toContain("dívidas caras");
  });

  it("o que resta segue a ordem: reserva, dívida, depois o resto", () => {
    const allocation = suggestAllocation({
      ...base,
      reserveMissing: "900.00",
      expensiveDebtBalance: "20000.00",
      alreadyInvesting: "1500.00",
    });
    // Restam 1.500: reserva 900, dívida o resto. Nada para aposentadoria nova, metas ou viagens.
    expect(allocation).toMatchObject({
      reserve: "900.00",
      debt: "600.00",
      retirement: "1500.00",
      goalsBudget: "0.00",
      tripsBudget: "0.00",
    });
  });

  it("quem segue a sugestão recebe a mesma sugestão", () => {
    const first = suggestAllocation(base);
    const next = suggestAllocation({
      ...base,
      alreadyInvesting: first.retirement,
      alreadySavingForGoals: first.goalsBudget,
    });
    expect(next).toMatchObject({
      reserve: first.reserve,
      retirement: first.retirement,
      goalsBudget: first.goalsBudget,
      tripsBudget: first.tripsBudget,
      reserveShort: "0.00",
    });
  });

  it("sem hábito, nada a redirecionar", () => {
    expect(suggestAllocation(base)).toMatchObject({ reserveShort: "0.00", redirectable: "0.00" });
  });

  it("o plano do mês não pede para guardar mais quando reserva e dívida estão curtas", () => {
    const input = {
      today: "2026-11-02",
      targetYear: 2050,
      targetIncome: "10000.00",
      essentialMonthly: "3000.00",
      averageExpenses12: "6000.00",
      pensions: [],
      assets: [],
      expectedYield: "6.00",
      dividendGrowth: "0",
      contribution: "3000.00",
    };
    const actions = monthlyPlan({
      base: input,
      plan: planDividendRetirement(input),
      contribution: "3000.00",
      allocation: suggestAllocation({ ...base, alreadyInvesting: "3000.00" }),
      largestCategory: null,
    });
    expect(actions.some((action) => action.kind === "guardar")).toBe(false);
  });
});

describe("F2. parcela de meta que a família paga", () => {
  const base = {
    available: "3600.00",
    reserveMissing: "90000.00",
    expensiveDebtBalance: "0.00",
    retirementRequired: "5000.00",
    confirmedTripsMonthly: "0.00",
  };

  it("mede o hábito de meta sem somar a entrada no destino", () => {
    const rows = MONTHS.flatMap((m) => [
      tx("s", m, "receita", "sa", "10000.00"),
      tx("p", m, "despesa", "me", "300.00"),
      tx("d", m, "receita", "me-r", "300.00"),
    ]);
    const saved = savedByMonth(MONTHS, rows, rule);
    expect(saved.at(-1)).toEqual({ month: "2026-10", invested: "0.00", goals: "300.00" });
  });

  it("a parcela real ocupa o orçamento de metas e não é contada duas vezes", () => {
    const allocation = suggestAllocation({
      ...base,
      alreadyInvesting: "2900.00",
      alreadySavingForGoals: "300.00",
    });
    expect(allocation).toMatchObject({
      reserve: "400.00",
      retirement: "2900.00",
      goalsBudget: "300.00",
      alreadySavingForGoals: "300.00",
      tripsBudget: "0.00",
    });
    expect(sum(allocation.reserve, allocation.retirement, allocation.goalsBudget)).toBe("3600.00");
  });
});

describe("5. fluxo", () => {
  it("mês só com resgate não some", () => {
    const zero = "0.00";
    const summary = {
      received: zero,
      spent: zero,
      balance: zero,
      contributed: zero,
      redeemed: "5000.00",
      afterContributions: zero,
      plannedIncome: zero,
      plannedExpense: zero,
      plannedContribution: zero,
      plannedRedemption: zero,
      projectedBalance: zero,
    };
    const draft = buildFluxo({
      month: "2026-08",
      asOf: "2026-08-31",
      summary,
      planned: { income: zero, expense: zero, contribution: zero },
      next: [],
    });
    expect(draft).not.toBeNull();
  });
});

describe("9. NO_SAVINGS", () => {
  it("é a conta de antes de verdade: parcela prevista de meta volta a ser despesa", () => {
    const entries = buildMonthEntries(
      "2026-10",
      [],
      [],
      [
        {
          key: "g:x:2026-10",
          source: "meta",
          id: "x",
          kind: "despesa",
          description: "Meta",
          amount: "300.00",
          date: "2026-10-20",
          categoryId: "",
          accountId: "a",
        },
      ],
    );
    expect(summarizeMonth(entries, NO_SAVINGS)).toMatchObject({
      plannedExpense: "300.00",
      plannedContribution: "0.00",
    });
    expect(summarizeMonth(entries, rule)).toMatchObject({
      plannedExpense: "0.00",
      plannedContribution: "300.00",
    });
  });
});

describe("F5. o que `min(média, mediana)` faz com o hábito", () => {
  const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
  const points: MonthPoint[] = months.map((month) => ({
    month,
    received: "10000.00",
    spent: "6000.00",
    balance: "4000.00",
    contributed: "3000.00",
    redeemed: "0.00",
  }));
  const habit = (value: (index: number) => string) =>
    savingHabit(
      months.map((_, i) => value(i)),
      points,
    );

  it.each([
    ["3.000 fixos", () => "3000.00", "3000.00"],
    ["um resgate de 20.000 no ano", (i: number) => (i === 5 ? "-17000.00" : "3000.00"), "1333.33"],
    ["um resgate de 40.000 no ano", (i: number) => (i === 5 ? "-37000.00" : "3000.00"), "0.00"],
    ["um aporte único de 50.000", (i: number) => (i === 5 ? "50000.00" : "0.00"), "0.00"],
    ["começou há três meses", (i: number) => (i >= 9 ? "3000.00" : "0.00"), "0.00"],
    ["6.000 em meses alternados", (i: number) => (i % 2 ? "6000.00" : "0.00"), "3000.00"],
    ["9.000 por trimestre", (i: number) => (i % 3 === 0 ? "9000.00" : "0.00"), "0.00"],
  ])("%s", (_, value, expected) => {
    expect(habit(value)).toBe(expected);
  });
});
