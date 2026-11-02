import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  buildMonthEntries,
  spendingByCategory,
  summarizeMonth,
  type TransactionInput,
} from "../src/cashflow";
import type { CardBookEntry } from "../src/dashboard";
import { NO_SAVINGS } from "../src/savings";
import {
  activityByAccount,
  cardsInMonth,
  clampToRange,
  comparableTotals,
  dividendsInMonth,
  expenseLines,
  foldCategories,
  hasAnything,
  hasMovement,
  incomeLines,
  investedUntil,
  monthPhase,
  pickerMonths,
  pickerYears,
  planPoint,
  plannedNetByAccount,
  projectBalances,
  resolvePeriod,
} from "../src/dashboard";
import { purchaseLines } from "../src/card";
import { money } from "../src/money";

const tx = (over: Partial<TransactionInput> = {}): TransactionInput => ({
  id: "t1",
  kind: "despesa",
  description: "Mercado",
  amount: "200.00",
  occurredOn: "2026-10-05",
  status: "realizado",
  categoryId: "mercado",
  accountId: "a1",
  planId: null,
  planMonth: null,
  ...over,
});

const fatura = {
  key: "f:k1:2026-10",
  source: "fatura" as const,
  id: "k1",
  description: "Fatura",
  amount: "400.00",
  date: "2026-10-10",
  categoryId: "cartao",
  accountId: "a1",
};

describe("mês do painel", () => {
  const today = "2026-11-01";

  it("sem pedido, abre o mês atual no fuso de quem chamou", () => {
    const period = resolvePeriod(undefined, today, "2026-03-15");
    expect(period).toEqual({
      month: "2026-11",
      current: "2026-11",
      first: "2026-03",
      last: "2027-11",
      phase: "atual",
      previous: "2026-10",
      next: "2026-12",
    });
  });

  it("valor inválido cai no mês atual, sem erro", () => {
    for (const bad of ["", "2026", "2026-13", "2026-00", "abc", "2026-1", null, 5, ["2026-10"]]) {
      expect(resolvePeriod(bad, today, "2026-03-15").month).toBe("2026-11");
    }
  });

  it("mês fora da faixa cai no mês atual", () => {
    expect(resolvePeriod("2026-02", today, "2026-03-15").month).toBe("2026-11");
    expect(resolvePeriod("2027-12", today, "2026-03-15").month).toBe("2026-11");
    expect(resolvePeriod("2027-11", today, "2026-03-15").month).toBe("2027-11");
    expect(resolvePeriod("2026-03", today, "2026-03-15").month).toBe("2026-03");
  });

  it("nos limites não há para onde ir", () => {
    expect(resolvePeriod("2026-03", today, "2026-03-15").previous).toBeNull();
    expect(resolvePeriod("2027-11", today, "2026-03-15").next).toBeNull();
  });

  it("sem dado, a faixa começa no mês atual", () => {
    const period = resolvePeriod("2026-10", today, null);
    expect(period).toMatchObject({ month: "2026-11", first: "2026-11", previous: null });
  });

  it("primeiro dado no futuro não tira o mês atual da faixa", () => {
    expect(resolvePeriod(undefined, today, "2027-02-01").first).toBe("2026-11");
  });

  it("virada de ano: dezembro e janeiro em volta", () => {
    expect(resolvePeriod("2027-01", "2026-12-31", "2026-01-01")).toMatchObject({
      month: "2027-01",
      phase: "futuro",
      previous: "2026-12",
      next: "2027-02",
      last: "2027-12",
    });
    expect(resolvePeriod(undefined, "2027-01-01", "2026-01-01")).toMatchObject({
      month: "2027-01",
      previous: "2026-12",
      phase: "atual",
    });
    expect(resolvePeriod("2026-12", "2027-01-01", "2026-01-01").phase).toBe("passado");
  });

  it("três fases", () => {
    expect(monthPhase("2026-10", "2026-11")).toBe("passado");
    expect(monthPhase("2026-11", "2026-11")).toBe("atual");
    expect(monthPhase("2026-12", "2026-11")).toBe("futuro");
  });

  it("listas de ano e mês respeitam a faixa", () => {
    expect(pickerYears("2025-11", "2027-11")).toEqual(["2027", "2026", "2025"]);
    expect(pickerMonths("2025", "2025-11", "2027-11")).toEqual(["2025-11", "2025-12"]);
    expect(pickerMonths("2027", "2025-11", "2027-02")).toEqual(["2027-01", "2027-02"]);
    expect(pickerMonths("2026", "2025-11", "2027-11")).toHaveLength(12);
  });

  it("trocar o ano fica no mês mais perto dentro da faixa", () => {
    expect(clampToRange("2025-03", "2025-11", "2027-11")).toBe("2025-11");
    expect(clampToRange("2027-12", "2025-11", "2027-11")).toBe("2027-11");
    expect(clampToRange("2026-03", "2025-11", "2027-11")).toBe("2026-03");
  });

  it("toda escolha válida da lista resolve para ela mesma", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), (index) => {
        const months = pickerYears("2024-01", "2027-11").flatMap((year) =>
          pickerMonths(year, "2024-01", "2027-11"),
        );
        const month = months[index % months.length]!;
        expect(resolvePeriod(month, today, "2024-01-20").month).toBe(month);
      }),
    );
  });
});

describe("categorias do mês", () => {
  const lines = [
    { cardId: "k1", categoryId: "mercado", amount: "300.00" },
    { cardId: "k1", categoryId: "lazer", amount: "100.00" },
  ];

  it("fatura em aberto: compras previstas, abertas por categoria", () => {
    const entries = buildMonthEntries("2026-10", [], [tx()], [fatura]);
    expect(expenseLines(entries, lines, "cartao", NO_SAVINGS)).toEqual([
      { categoryId: "mercado", amount: "500.00", done: "200.00", planned: "300.00" },
      { categoryId: "lazer", amount: "100.00", done: "0.00", planned: "100.00" },
    ]);
  });

  it("fatura paga: compras feitas e sem contar duas vezes", () => {
    const paid = tx({ id: "t2", amount: "400.00", categoryId: "cartao", occurredOn: "2026-10-10" });
    const entries = buildMonthEntries("2026-10", [], [tx(), paid]);
    expect(expenseLines(entries, lines, "cartao", NO_SAVINGS)).toEqual([
      { categoryId: "mercado", amount: "500.00", done: "500.00", planned: "0.00" },
      { categoryId: "lazer", amount: "100.00", done: "100.00", planned: "0.00" },
    ]);
  });

  it("pagamento de fatura sem compras lançadas não some das categorias", () => {
    const bank = tx({ id: "t2", amount: "900.00", categoryId: "cartao" });
    const entries = buildMonthEntries("2026-10", [], [tx(), bank]);
    expect(spendingByCategory(entries, [], "cartao", NO_SAVINGS)).toEqual([
      { categoryId: "cartao", amount: "900.00" },
      { categoryId: "mercado", amount: "200.00" },
    ]);
  });

  it("o total das categorias é o total de despesas do mês", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100_000 }), { minLength: 1, maxLength: 6 }),
        fc.array(fc.integer({ min: 1, max: 100_000 }), { maxLength: 6 }),
        fc.boolean(),
        (plain, purchases, paid) => {
          const cents = (value: number) => (value / 100).toFixed(2);
          const cardLines = purchases.map((value) => ({
            cardId: "k1",
            categoryId: `c${value % 3}`,
            amount: cents(value),
          }));
          const bill = cardLines.reduce((acc, line) => acc.plus(line.amount), money(0)).toFixed(2);
          const rows = plain.map((value, index) =>
            tx({ id: `t${index}`, amount: cents(value), categoryId: `c${value % 3}` }),
          );
          const hasBill = cardLines.length > 0;
          const entries = buildMonthEntries(
            "2026-10",
            [],
            paid && hasBill
              ? [...rows, tx({ id: "tf", amount: bill, categoryId: "cartao" })]
              : rows,
            !paid && hasBill ? [{ ...fatura, amount: bill }] : [],
          );
          const summary = summarizeMonth(entries, NO_SAVINGS);
          const folded = foldCategories(expenseLines(entries, cardLines, "cartao", NO_SAVINGS), 2);
          expect(folded.total).toBe(money(summary.spent).plus(summary.plannedExpense).toFixed(2));
        },
      ),
    );
  });

  it("receitas por categoria separam recebido e previsto", () => {
    const entries = buildMonthEntries(
      "2026-10",
      [
        {
          id: "p1",
          kind: "receita",
          description: "Aluguel recebido",
          amount: "800.00",
          dayOfMonth: 5,
          startMonth: "2026-01",
          endMonth: null,
          categoryId: "aluguel",
          accountId: "a1",
        },
      ],
      [tx({ kind: "receita", amount: "5000.00", categoryId: "salario" })],
    );
    expect(incomeLines(entries, NO_SAVINGS)).toEqual([
      { categoryId: "salario", amount: "5000.00", done: "5000.00", planned: "0.00" },
      { categoryId: "aluguel", amount: "800.00", done: "0.00", planned: "800.00" },
    ]);
  });

  it("dobra a cauda em Outras, com valor e percentual", () => {
    const rows = ["a", "b", "c", "d"].map((id, index) => ({
      categoryId: id,
      amount: `${(4 - index) * 100}.00`,
      done: `${(4 - index) * 100}.00`,
      planned: "0.00",
    }));
    const folded = foldCategories(rows, 2);
    expect(folded.rows.map((row) => row.categoryId)).toEqual(["a", "b"]);
    expect(folded.rows[0]!.percent).toBe(40);
    expect(folded.other).toEqual({
      amount: "300.00",
      done: "300.00",
      planned: "0.00",
      percent: 30,
      count: 2,
    });
    expect(folded.total).toBe("1000.00");
  });

  it("uma só na cauda fica com o próprio nome", () => {
    const rows = ["a", "b", "c"].map((id) => ({
      categoryId: id,
      amount: "100.00",
      done: "100.00",
      planned: "0.00",
    }));
    const folded = foldCategories(rows, 2);
    expect(folded.rows).toHaveLength(3);
    expect(folded.other).toBeNull();
  });
});

describe("resumo do mês", () => {
  const empty = summarizeMonth([], NO_SAVINGS);

  it("sabe quando o mês tem movimento e quando só tem previsão", () => {
    expect(hasMovement(empty)).toBe(false);
    expect(hasAnything(empty)).toBe(false);
    const planned = summarizeMonth(buildMonthEntries("2026-10", [], [], [fatura]), NO_SAVINGS);
    expect(hasMovement(planned)).toBe(false);
    expect(hasAnything(planned)).toBe(true);
    expect(hasMovement(summarizeMonth(buildMonthEntries("2026-10", [], [tx()]), NO_SAVINGS))).toBe(
      true,
    );
  });

  it("compara feito com feito e, em mês futuro, o previsto", () => {
    const entries = buildMonthEntries("2026-10", [], [tx()], [fatura]);
    const summary = summarizeMonth(entries, NO_SAVINGS);
    expect(comparableTotals(summary, "passado")).toMatchObject({ income: "0.00", expense: "200.00" });
    expect(comparableTotals(summary, "futuro")).toMatchObject({ income: "0.00", expense: "600.00" });
  });

  it("o ponto do gráfico leva feito e previsto", () => {
    const summary = summarizeMonth(buildMonthEntries("2026-10", [], [tx()], [fatura]), NO_SAVINGS);
    expect(planPoint("2026-10", summary)).toMatchObject({
      month: "2026-10",
      received: "0.00",
      spent: "200.00",
      balance: "-200.00",
      plannedIncome: "0.00",
      plannedExpense: "400.00",
    });
  });

  it("mês só com aporte não é mês vazio", () => {
    const rule = { ...NO_SAVINGS, investmentCategories: new Set(["aportes"]) };
    const entries = buildMonthEntries(
      "2026-10",
      [],
      [tx({ amount: "500.00", categoryId: "aportes" })],
    );
    const summary = summarizeMonth(entries, rule);
    expect(summary.spent).toBe("0.00");
    expect(hasMovement(summary)).toBe(true);
  });
});

describe("contas no mês", () => {
  const entries = buildMonthEntries(
    "2026-10",
    [],
    [
      tx({ kind: "receita", amount: "1000.00" }),
      tx({ id: "t2", amount: "300.00", accountId: "a2" }),
      tx({ id: "t3", amount: "50.00", accountId: "a2", status: "previsto" }),
    ],
  );

  it("a soma das contas é o total do mês", () => {
    const activity = activityByAccount(entries, NO_SAVINGS);
    expect(activity.get("a1")).toMatchObject({ received: "1000.00", spent: "0.00" });
    expect(activity.get("a2")).toMatchObject({ spent: "300.00", plannedExpense: "50.00" });
    const summary = summarizeMonth(entries, NO_SAVINGS);
    const spent = [...activity.values()].reduce((acc, row) => acc.plus(row.spent), money(0));
    expect(spent.toFixed(2)).toBe(summary.spent);
  });

  it("projeta o saldo pelos previstos, mês a mês", () => {
    const later = buildMonthEntries(
      "2026-11",
      [],
      [tx({ id: "t9", amount: "100.00", status: "previsto", occurredOn: "2026-11-05" })],
    );
    const planned = plannedNetByAccount([
      activityByAccount(entries, NO_SAVINGS),
      activityByAccount(later, NO_SAVINGS),
    ]);
    const { rows, total } = projectBalances(
      [
        { id: "a1", balance: "1000.00", archived: false },
        { id: "a2", balance: "500.00", archived: false },
        { id: "a3", balance: "7.00", archived: true },
      ],
      planned,
    );
    expect(rows.map((row) => row.projected)).toEqual(["900.00", "450.00", "7.00"]);
    expect(total).toBe("1350.00");
  });
});

describe("cartões no mês", () => {
  const card = { id: "k1", name: "Cartão", closingDay: 28, dueDay: 10, archived: false };
  const purchase = {
    id: "c1",
    cardId: "k1",
    categoryId: "mercado",
    description: "Geladeira",
    amount: "1200.00",
    installments: 3,
    purchasedOn: "2026-09-15",
  };
  const book = (paid: string[]): CardBookEntry[] => [
    { card, lines: purchaseLines(purchase, card), paid: new Set(paid) },
  ];

  it("compra parcelada: a parcela do mês e o que ficou para as próximas", () => {
    expect(cardsInMonth(book([]), "2026-10", "2026-10-20")).toEqual([
      {
        id: "k1",
        name: "Cartão",
        statement: "400.00",
        status: "atrasada",
        ahead: "800.00",
      },
    ]);
    expect(cardsInMonth(book(["2026-10"]), "2026-10", "2026-11-01")[0]!.status).toBe("paga");
    expect(cardsInMonth(book([]), "2026-12", "2026-11-01")[0]).toMatchObject({
      statement: "400.00",
      status: "aberta",
      ahead: "0.00",
    });
  });

  it("em mês passado, a próxima fatura só conta o que já tinha sido comprado", () => {
    expect(cardsInMonth(book([]), "2026-08", "2026-11-01")[0]).toMatchObject({
      statement: "0.00",
      status: null,
      ahead: "0.00",
    });
  });

  it("cartão arquivado sem nada some; ativo fica", () => {
    expect(cardsInMonth(book([]), "2027-06", "2026-11-01")).toHaveLength(1);
    const archived = book([]).map((entry) => ({
      ...entry,
      card: { ...entry.card, archived: true },
    }));
    expect(cardsInMonth(archived, "2027-06", "2026-11-01")).toEqual([]);
  });
});

describe("investimentos no mês", () => {
  const trade = (occurredOn: string, side: "compra" | "venda", quantity: string) => ({
    side,
    occurredOn,
    quantity,
    unitPrice: "10.00",
    fees: "0.00",
  });

  it("valor aplicado no fim do mês só com as operações até lá", () => {
    const list = [
      {
        id: "i1",
        assetClass: "acao",
        currentPrice: "50.00",
        currentValue: null,
        trades: [
          trade("2026-05-10", "compra", "100"),
          trade("2026-09-10", "compra", "100"),
          trade("2026-10-10", "venda", "50"),
        ],
      },
    ];
    expect(investedUntil(list, "2026-04-30")).toBe("0.00");
    expect(investedUntil(list, "2026-05-31")).toBe("1000.00");
    expect(investedUntil(list, "2026-09-30")).toBe("2000.00");
    expect(investedUntil(list, "2026-10-31")).toBe("1500.00");
  });

  it("evento depois da data não mexe no custo daquele mês", () => {
    const list = [
      {
        id: "i1",
        assetClass: "acao",
        currentPrice: null,
        currentValue: null,
        trades: [trade("2026-05-10", "compra", "100"), trade("2026-09-10", "venda", "50")],
        events: [{ comDate: "2026-08-01", factor: "2" }],
      },
    ];
    expect(investedUntil(list, "2026-07-31")).toBe("1000.00");
    expect(investedUntil(list, "2026-09-30")).toBe("750.00");
  });
});

describe("proventos no mês", () => {
  const row = (paidOn: string, gross: string, withheld = "0.00") => ({
    investmentId: "i1",
    kind: "dividendo" as const,
    paidOn,
    gross,
    withheld,
  });
  const today = "2026-11-10";
  const rows = [
    row("2026-10-15", "100.00", "15.00"),
    row("2026-11-05", "50.00"),
    row("2026-11-20", "30.00"),
    row("2026-12-20", "40.00"),
    row("2025-10-15", "999.00"),
  ];

  it("recebido, anunciado no mês, anunciado depois e 12 meses", () => {
    expect(dividendsInMonth(rows, "2026-11", today)).toMatchObject({
      received: "50.00",
      announced: "30.00",
      ahead: "40.00",
      last12: "135.00",
    });
  });

  it("em mês passado, os 12 meses terminam nele e tudo que vem depois é anúncio", () => {
    expect(dividendsInMonth(rows, "2026-10", today)).toMatchObject({
      received: "85.00",
      announced: "0.00",
      ahead: "70.00",
      last12: "85.00",
      estimate: null,
    });
  });

  it("em mês futuro não há recebido, e a estimativa vem à parte", () => {
    const yearly = [row("2025-12-05", "60.00")];
    expect(dividendsInMonth(yearly, "2026-12", today)).toMatchObject({
      received: "0.00",
      estimate: "60.00",
    });
    expect(dividendsInMonth([], "2026-12", today).estimate).toBeNull();
  });
});
