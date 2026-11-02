import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  buildMonthEntries,
  spendingByCategory,
  summarizeMonth,
  type MonthEntry,
  type MonthPoint,
  type TransactionInput,
} from "../src/cashflow";
import {
  buildAnual,
  buildAposentadoria,
  buildCategorias,
  buildDividas,
  buildFluxo,
  buildInvestimentos,
  buildMetas,
  buildPatrimonio,
  buildProventos,
  buildResumo,
  categoryChanges,
  compareFigures,
  forecastByMonth,
  fromFirstMovement,
  goalOnTime,
  incomeByCategory,
  isStatementKind,
  isStatementPeriod,
  largestExpenses,
  mergeCategoryTotals,
  monthsAverage,
  plannedForMonth,
  previousPeriod,
  projectMonths,
  stableJson,
  STATEMENT_FIGURES,
  STATEMENT_KINDS,
  tradesByMonth,
  type StatementData,
} from "../src/household-statement";
import { summarizeDividends, summarizePortfolio } from "../src/investment";
import { money, toDbAmount } from "../src/money";

const figure = (data: StatementData | undefined, id: (typeof STATEMENT_FIGURES)[number]) =>
  data?.figures.find((item) => item.id === id)?.value;

const summary = (received: string, spent: string, plannedIncome = "0", plannedExpense = "0") => {
  const balance = money(received).minus(spent);
  return {
    received: toDbAmount(received),
    spent: toDbAmount(spent),
    balance: toDbAmount(balance),
    plannedIncome: toDbAmount(plannedIncome),
    plannedExpense: toDbAmount(plannedExpense),
    projectedBalance: toDbAmount(balance.plus(plannedIncome).minus(plannedExpense)),
  };
};

const point = (month: string, received: string, spent: string): MonthPoint => ({
  month,
  received,
  spent,
  balance: toDbAmount(money(received).minus(spent)),
});

const amountArb = fc
  .integer({ min: 1, max: 5_000_000 })
  .map((cents) => toDbAmount(money(cents).dividedBy(100)));

const entryArb = fc.record({
  kind: fc.constantFrom("receita" as const, "despesa" as const),
  amount: amountArb,
  category: fc.constantFrom("mercado", "moradia", "lazer", "saude"),
  status: fc.constantFrom("realizado" as const, "previsto" as const),
});

const transactionsOf = (rows: Array<typeof entryArb extends fc.Arbitrary<infer T> ? T : never>) =>
  rows.map((row, index): TransactionInput => ({
    id: `t${index}`,
    kind: row.kind,
    description: `Lançamento ${index}`,
    amount: row.amount,
    occurredOn: "2026-10-10",
    status: row.status,
    categoryId: row.category,
    accountId: "conta",
    planId: null,
    planMonth: null,
  }));

describe("período", () => {
  it("aceita mês e ano e volta um período", () => {
    expect(isStatementPeriod("2026-10")).toBe(true);
    expect(isStatementPeriod("2026")).toBe(true);
    expect(isStatementPeriod("2026-13")).toBe(false);
    expect(isStatementPeriod("x")).toBe(false);
    expect(previousPeriod("2026-01")).toBe("2025-12");
    expect(previousPeriod("2026")).toBe("2025");
  });

  it("conhece os dez tipos", () => {
    expect(STATEMENT_KINDS).toHaveLength(10);
    expect(isStatementKind("anual")).toBe(true);
    expect(isStatementKind("outro")).toBe(false);
  });
});

describe("média dos meses", () => {
  it("ignora mês sem movimento", () => {
    const average = monthsAverage([
      point("2026-01", "0.00", "0.00"),
      point("2026-02", "1000.00", "400.00"),
      point("2026-03", "3000.00", "800.00"),
    ]);
    expect(average).toEqual({
      months: 2,
      received: "2000.00",
      spent: "600.00",
      balance: "1400.00",
    });
  });

  it("sem movimento, zero", () => {
    expect(monthsAverage([])).toMatchObject({ months: 0, balance: "0.00" });
  });
});

describe("meses vazios", () => {
  it("saem só do começo", () => {
    const rows = [0, 0, 5, 0, 7];
    expect(fromFirstMovement(rows, (row) => row > 0)).toEqual([5, 0, 7]);
    expect(fromFirstMovement([0, 0], (row) => row > 0)).toEqual([0, 0]);
  });
});

describe("resumo do mês", () => {
  const input = {
    month: "2026-10",
    asOf: "2026-10-31",
    summary: summary("8000.00", "5000.00"),
    previous: summary("8000.00", "6000.00"),
    history: [point("2026-08", "7000.00", "6000.00"), point("2026-09", "8000.00", "6000.00")],
    largest: [{ description: "Aluguel", date: "2026-10-05", amount: "2000.00" }],
  };

  it("entrou menos saiu é o que sobrou, com o mês anterior e a média ao lado", () => {
    const draft = buildResumo(input);
    expect(figure(draft?.data, "left")).toEqual({ money: "3000.00" });
    expect(draft?.message).toEqual({
      key: "resumo",
      params: {
        received: { money: "8000.00" },
        spent: { money: "5000.00" },
        left: { money: "3000.00" },
      },
    });
    const comparison = draft?.data.sections.find((section) => section.id === "comparison");
    expect(comparison?.rows[1]).toEqual([
      { label: "saiu" },
      { money: "5000.00" },
      { money: "6000.00" },
      { percent: -17 },
      { money: "6000.00" },
      { percent: -17 },
    ]);
  });

  it("não guarda frase pronta", () => {
    const text = JSON.stringify(buildResumo(input));
    expect(text).not.toMatch(/Entraram|sobraram|mês/);
  });

  it("mês vazio não vira relatório", () => {
    expect(
      buildResumo({ ...input, summary: summary("0", "0"), largest: [], history: [] }),
    ).toBeNull();
  });

  it("propriedade: entrou − saiu = sobrou, como no painel", () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 40 }), (rows) => {
        const month = "2026-10";
        const panel = summarizeMonth(buildMonthEntries(month, [], transactionsOf(rows)));
        const draft = buildResumo({ ...input, month, summary: panel, largest: [] });
        if (!draft) return;
        const cents = (id: "received" | "spent" | "left") => {
          const value = figure(draft.data, id);
          return money((value as { money: string }).money);
        };
        expect(cents("received").minus(cents("spent")).eq(cents("left"))).toBe(true);
        expect(figure(draft.data, "left")).toEqual({ money: panel.balance });
      }),
    );
  });
});

describe("maiores gastos", () => {
  const entries: MonthEntry[] = [
    {
      key: "t:1",
      source: "lancamento",
      id: "1",
      kind: "despesa",
      description: "Aluguel",
      amount: "2000.00",
      date: "2026-10-05",
      status: "realizado",
      categoryId: "moradia",
      accountId: "a",
      recurring: false,
    },
    {
      key: "t:2",
      source: "lancamento",
      id: "2",
      kind: "despesa",
      description: "Fatura",
      amount: "3000.00",
      date: "2026-10-10",
      status: "realizado",
      categoryId: "cartao",
      accountId: "a",
      recurring: false,
    },
    {
      key: "p:3",
      source: "previsao",
      id: "3",
      kind: "despesa",
      description: "Ainda vem",
      amount: "9000.00",
      date: "2026-10-20",
      status: "previsto",
      categoryId: "lazer",
      accountId: "a",
      recurring: true,
    },
  ];

  it("abre a fatura nas compras e deixa o previsto de fora", () => {
    const lines = [
      { description: "TV", purchasedOn: "2026-09-20", amount: "2500.00", categoryId: "casa" },
    ];
    expect(largestExpenses(entries, lines, "cartao").map((row) => row.description)).toEqual([
      "TV",
      "Aluguel",
    ]);
  });
});

describe("gastos por categoria", () => {
  const names = new Map([
    ["mercado", "Mercado"],
    ["moradia", "Moradia"],
    ["lazer", "Lazer"],
  ]);

  it("mostra o que subiu e o que caiu", () => {
    const { up, down } = categoryChanges(
      [
        { categoryId: "mercado", amount: "900.00" },
        { categoryId: "lazer", amount: "100.00" },
      ],
      [
        { categoryId: "mercado", amount: "600.00" },
        { categoryId: "moradia", amount: "500.00" },
      ],
    );
    expect(up).toEqual([
      { categoryId: "mercado", amount: "900.00", previous: "600.00", delta: "300.00" },
      { categoryId: "lazer", amount: "100.00", previous: "0.00", delta: "100.00" },
    ]);
    expect(down).toEqual([
      { categoryId: "moradia", amount: "0.00", previous: "500.00", delta: "-500.00" },
    ]);
  });

  it("propriedade: a soma das categorias bate com o total, e a fatura não conta duas vezes", () => {
    fc.assert(
      fc.property(
        fc.array(entryArb, { maxLength: 40 }),
        fc.array(
          fc.record({ categoryId: fc.constantFrom("mercado", "lazer"), amount: amountArb }),
          {
            maxLength: 10,
          },
        ),
        (rows, lines) => {
          const entries = buildMonthEntries(
            "2026-10",
            [],
            [
              ...transactionsOf(rows),
              ...transactionsOf(rows).map((row) => ({
                ...row,
                id: `f${row.id}`,
                categoryId: "cartao",
                kind: "despesa" as const,
              })),
            ],
          );
          const byCategory = spendingByCategory(entries, lines, "cartao");
          const draft = buildCategorias({
            month: "2026-10",
            asOf: "2026-10-31",
            byCategory,
            previous: [],
            names,
            evolution: [],
          });
          if (!draft) {
            expect(byCategory).toEqual([]);
            return;
          }
          const ranking = draft.data.sections.find((section) => section.id === "ranking")!;
          const sum = ranking.rows.reduce(
            (acc, row) => acc.plus((row[1] as { money: string }).money),
            money(0),
          );
          expect(figure(draft.data, "total")).toEqual({ money: toDbAmount(sum) });
          expect(byCategory.some((row) => row.categoryId === "cartao")).toBe(false);
          const expenses = rows.filter((row) => row.kind === "despesa");
          const expected = [...expenses, ...lines].reduce(
            (acc, row) => acc.plus(row.amount),
            money(0),
          );
          expect(sum.eq(expected)).toBe(true);
        },
      ),
    );
  });

  it("sem base, não inventa variação", () => {
    const draft = buildCategorias({
      month: "2026-10",
      asOf: "2026-10-31",
      byCategory: [{ categoryId: "mercado", amount: "900.00" }],
      previous: [],
      names,
      evolution: [],
    });
    expect(figure(draft?.data, "change")).toBeUndefined();
    expect(figure(draft?.data, "topCategory")).toEqual({ category: "Mercado" });
  });
});

describe("fluxo de caixa", () => {
  it("previsto cobre o que já foi feito e o que falta", () => {
    expect(
      plannedForMonth(
        "2026-10",
        [
          { kind: "despesa", amount: "1000.00", startMonth: "2026-01", endMonth: null },
          { kind: "despesa", amount: "9.00", startMonth: "2026-11", endMonth: null },
          { kind: "receita", amount: "5000.00", startMonth: "2026-01", endMonth: "2026-10" },
        ],
        [
          { kind: "despesa", amount: "300.00" },
          { kind: "receita", amount: "200.00" },
        ],
      ),
    ).toEqual({ income: "5200.00", expense: "1300.00" });
  });

  it("projeta os próximos meses somando a sobra", () => {
    expect(
      projectMonths([
        { month: "2026-11", summary: summary("0", "0", "1000", "400") },
        { month: "2026-12", summary: summary("0", "0", "1000", "1300") },
      ]),
    ).toEqual([
      {
        month: "2026-11",
        income: "1000.00",
        expense: "400.00",
        left: "600.00",
        accumulated: "600.00",
      },
      {
        month: "2026-12",
        income: "1000.00",
        expense: "1300.00",
        left: "-300.00",
        accumulated: "300.00",
      },
    ]);
  });

  it("compara previsto e realizado", () => {
    const draft = buildFluxo({
      month: "2026-10",
      asOf: "2026-10-31",
      summary: summary("5000.00", "4500.00"),
      planned: { income: "5000.00", expense: "4000.00" },
      next: [{ month: "2026-11", summary: summary("0", "0", "5000", "4000") }],
    });
    const table = draft?.data.sections.find((section) => section.id === "plannedActual");
    expect(table?.rows[1]).toEqual([
      { label: "saiu" },
      { money: "4000.00" },
      { money: "4500.00" },
      { money: "500.00" },
    ]);
    expect(figure(draft?.data, "projected")).toEqual({ money: "1000.00" });
  });
});

describe("patrimônio", () => {
  const history = [
    { month: "2026-09", owned: "1000.00", owed: "200.00", net: "800.00" },
    { month: "2026-10", owned: "1500.00", owed: "200.00", net: "1300.00" },
  ];

  it("fechado usa a foto do mês, sem inventar o detalhe", () => {
    const draft = buildPatrimonio({ month: "2026-10", asOf: "2026-10-31", summary: null, history });
    expect(figure(draft?.data, "net")).toEqual({ money: "1300.00" });
    expect(figure(draft?.data, "change")).toEqual({ money: "500.00" });
    expect(draft?.data.notes).toEqual(["semDetalhe"]);
    expect(draft?.data.sections.map((section) => section.id)).toEqual(["evolution"]);
  });

  it("sem foto nem patrimônio, nada", () => {
    expect(
      buildPatrimonio({ month: "2026-10", asOf: "2026-10-31", summary: null, history: [] }),
    ).toBeNull();
  });
});

describe("investimentos", () => {
  const trade = {
    side: "compra" as const,
    occurredOn: "2026-10-05",
    quantity: "10",
    unitPrice: "20",
    fees: "1.50",
  };

  it("soma compras e vendas do mês", () => {
    expect(
      tradesByMonth(
        ["2026-09", "2026-10"],
        [trade, { ...trade, side: "venda", quantity: "5", occurredOn: "2026-10-06" }],
      ),
    ).toEqual([
      { month: "2026-09", bought: "0.00", sold: "0.00" },
      { month: "2026-10", bought: "201.50", sold: "98.50" },
    ]);
  });

  it("compara com a meta da família e não cita ativo", () => {
    const portfolio = summarizePortfolio(
      [
        {
          id: "x",
          assetClass: "acao",
          currentPrice: "25",
          currentValue: null,
          trades: [trade],
        },
      ],
      [{ assetClass: "acao", percent: "60" }],
    );
    const draft = buildInvestimentos({
      month: "2026-10",
      asOf: "2026-10-31",
      portfolio,
      gainByClass: new Map([["acao", portfolio.gain]]),
      trades: tradesByMonth(["2026-10"], [trade]),
    });
    const classes = draft?.data.sections.find((section) => section.id === "classes");
    expect(classes?.rows[0]?.[0]).toEqual({ label: "classe_acao" });
    expect(classes?.rows[0]?.[3]).toEqual({ percent: 60 });
    expect(figure(draft?.data, "portfolio")).toEqual({ money: portfolio.total });
    expect(draft?.data.notes).toContain("semRecomendacao");
  });
});

describe("proventos", () => {
  const rows = [
    {
      investmentId: "a",
      kind: "dividendo" as const,
      paidOn: "2026-10-05",
      gross: "100.00",
      withheld: "10.00",
    },
  ];

  it("recebidos, por ativo e previsão", () => {
    const draft = buildProventos({
      month: "2026-10",
      asOf: "2026-10-31",
      summary: summarizeDividends(rows, "2026-10", null),
      names: new Map([["a", "ABCD3"]]),
      forecast: forecastByMonth([
        { investmentId: "a", month: "2026-11", amount: "10.00", basis: "mensal_12m" },
        { investmentId: "b", month: "2026-11", amount: "5.00", basis: "mensal_12m" },
      ]),
    });
    expect(figure(draft?.data, "month")).toEqual({ money: "90.00" });
    expect(draft?.data.sections.find((section) => section.id === "forecast")?.rows).toEqual([
      [{ month: "2026-11" }, { money: "15.00" }],
    ]);
  });
});

describe("dívidas", () => {
  it("soma saldo e juros, mesmo sem plano", () => {
    const draft = buildDividas({
      month: "2026-10",
      asOf: "2026-10-31",
      debts: [
        {
          name: "Empréstimo",
          monthlyRate: "2.00",
          balance: "900.00",
          interestPaid: "20.00",
          installmentsLeft: 3,
        },
      ],
      interest12: "100.00",
      plan: null,
    });
    expect(figure(draft?.data, "balance")).toEqual({ money: "900.00" });
    expect(figure(draft?.data, "interest")).toEqual({ money: "20.00" });
    expect(figure(draft?.data, "payoff")).toEqual({ label: "semPrazo" });
  });

  it("sem dívida nem juros, nada", () => {
    expect(
      buildDividas({
        month: "2026-10",
        asOf: "2026-10-31",
        debts: [],
        interest12: "0.00",
        plan: null,
      }),
    ).toBeNull();
  });
});

describe("metas e viagens", () => {
  const goal = {
    name: "Carro",
    status: "juntando" as const,
    target: "1000.00",
    saved: "250.00",
    desiredMonth: "2027-01",
    planEnd: "2026-12",
  };

  it("diz o que está no prazo", () => {
    expect(goalOnTime(goal)).toBe(true);
    expect(goalOnTime({ ...goal, planEnd: "2027-06" })).toBe(false);
    expect(goalOnTime({ ...goal, planEnd: null })).toBe(false);
    expect(goalOnTime({ ...goal, desiredMonth: null })).toBeNull();
    expect(goalOnTime({ ...goal, status: "concluida", planEnd: null })).toBe(true);
  });

  it("guardado a mais não vira falta negativa", () => {
    const draft = buildMetas({
      month: "2026-10",
      asOf: "2026-10-31",
      goals: [goal, { ...goal, saved: "2000.00", planEnd: "2027-06" }],
      trips: [],
    });
    expect(figure(draft?.data, "missing")).toEqual({ money: "750.00" });
    expect(figure(draft?.data, "late")).toEqual({ count: 1 });
    expect(draft?.message.params.late).toBe(1);
    const row = draft?.data.sections[0]?.rows[1];
    expect(row?.[4]).toEqual({ percent: 100 });
  });
});

describe("aposentadoria", () => {
  const plan = {
    status: "sem_dados",
    targetIncome: null,
    incomeGap: "0.00",
    currentIncome: "0.00",
    coverage: 0,
    incomeBase: "0.00",
    otherBase: "0.00",
    requiredPortfolio: null,
    requiredContribution: null,
    yearWithContribution: null,
    series: Array.from({ length: 30 }, (_, index) => ({
      year: 2027 + index,
      value: `${index + 1}000.00`,
      income: "10.00",
    })),
  } as unknown as Parameters<typeof buildAposentadoria>[0]["plan"];

  it("família sem nada não ganha relatório", () => {
    expect(
      buildAposentadoria({
        month: "2026-10",
        asOf: "2026-10-31",
        plan,
        contribution: "0.00",
        targetYear: null,
      }),
    ).toBeNull();
  });

  it("projeção cabe na página e mantém o primeiro e o último ano", () => {
    const draft = buildAposentadoria({
      month: "2026-10",
      asOf: "2026-10-31",
      plan: { ...plan, status: "ok", incomeBase: "1000.00", coverage: 40 },
      contribution: "500.00",
      targetYear: 2056,
    });
    const rows = draft?.data.sections[0]?.rows ?? [];
    expect(rows).toHaveLength(12);
    expect(rows[0]?.[0]).toEqual({ year: 2027 });
    expect(rows.at(-1)?.[0]).toEqual({ year: 2056 });
    expect(draft?.data.notes).toEqual(["estimativa"]);
  });
});

describe("anual", () => {
  const input = {
    year: "2026",
    asOf: "2026-12-31",
    months: [point("2026-01", "1000.00", "400.00"), point("2026-02", "1000.00", "500.00")],
    expenses: [{ categoryId: "c", amount: "900.00" }],
    incomes: [{ categoryId: "r", amount: "2000.00" }],
    names: new Map([
      ["c", "Mercado"],
      ["r", "Salário"],
    ]),
    dividends: [{ name: "ABCD3", gross: "100.00", withheld: "15.00" }],
    interestPaid: "12.00",
    positions: null,
  };

  it("deixa claro que não substitui a declaração", () => {
    const draft = buildAnual(input);
    expect(draft?.data.notes).toContain("anualNaoFiscal");
    expect(figure(draft?.data, "left")).toEqual({ money: "1100.00" });
    expect(figure(draft?.data, "dividends")).toEqual({ money: "85.00" });
  });

  it("ano sem nada lançado não vira relatório", () => {
    expect(buildAnual({ ...input, months: [], dividends: [] })).toBeNull();
  });
});

describe("somas e comparação", () => {
  it("junta categorias de vários meses, da maior para a menor", () => {
    expect(
      mergeCategoryTotals([
        [{ categoryId: "a", amount: "10.00" }],
        [
          { categoryId: "a", amount: "5.00" },
          { categoryId: "b", amount: "20.00" },
        ],
      ]),
    ).toEqual([
      { categoryId: "b", amount: "20.00" },
      { categoryId: "a", amount: "15.00" },
    ]);
  });

  it("receita do mês só conta o que entrou", () => {
    const entries = buildMonthEntries(
      "2026-10",
      [],
      [
        ...transactionsOf([
          { kind: "receita", amount: "10.00", category: "r", status: "realizado" },
          { kind: "receita", amount: "99.00", category: "r", status: "previsto" },
        ]),
      ],
    );
    expect(incomeByCategory(entries)).toEqual([{ categoryId: "r", amount: "10.00" }]);
  });

  it("compara dois períodos pelos números que os dois têm", () => {
    const a = buildResumo({
      month: "2026-10",
      asOf: "2026-10-31",
      summary: summary("1000.00", "400.00"),
      previous: summary("0", "0"),
      history: [],
      largest: [],
    })!.data;
    const b = buildResumo({
      month: "2026-09",
      asOf: "2026-09-30",
      summary: summary("800.00", "500.00"),
      previous: summary("0", "0"),
      history: [],
      largest: [],
    })!.data;
    const rows = compareFigures(a, b);
    expect(rows.find((row) => row.id === "left")).toMatchObject({
      current: { money: "600.00" },
      other: { money: "300.00" },
      delta: { money: "300.00" },
      percent: 100,
    });
  });

  it("texto estável não depende da ordem das chaves", () => {
    expect(stableJson({ b: 1, a: [{ d: 2, c: null }] })).toBe(
      stableJson({ a: [{ c: null, d: 2 }], b: 1 }),
    );
  });
});
