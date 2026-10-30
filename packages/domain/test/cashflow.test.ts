import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  addMonths,
  buildMonthEntries,
  expensesByCategory,
  monthBounds,
  occurrenceDate,
  summarizeMonth,
  type PlanInput,
  type TransactionInput,
} from "../src/cashflow";

const plan = (over: Partial<PlanInput> = {}): PlanInput => ({
  id: "p1",
  kind: "despesa",
  description: "Aluguel",
  amount: "1500.00",
  dayOfMonth: 10,
  startMonth: "2026-01",
  endMonth: null,
  categoryId: "moradia",
  accountId: "a1",
  ...over,
});

const tx = (over: Partial<TransactionInput> = {}): TransactionInput => ({
  id: "t1",
  kind: "despesa",
  description: "Mercado",
  amount: "200.10",
  occurredOn: "2026-03-05",
  status: "realizado",
  categoryId: "mercado",
  accountId: "a1",
  planId: null,
  planMonth: null,
  ...over,
});

describe("calendário do fluxo de caixa", () => {
  it("dia 31 cai no último dia de meses curtos", () => {
    expect(occurrenceDate(31, "2026-02")).toBe("2026-02-28");
    expect(occurrenceDate(31, "2028-02")).toBe("2028-02-29");
    expect(occurrenceDate(31, "2026-04")).toBe("2026-04-30");
    expect(occurrenceDate(10, "2026-04")).toBe("2026-04-10");
  });

  it("calcula limites e navega entre meses", () => {
    expect(monthBounds("2026-02")).toEqual({ first: "2026-02-01", last: "2026-02-28" });
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});

describe("entradas do mês", () => {
  it("mostra a previsão como prevista dentro da vigência", () => {
    const entries = buildMonthEntries("2026-03", [plan()], []);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: "previsao",
      status: "previsto",
      date: "2026-03-10",
    });
  });

  it("respeita início e fim da vigência", () => {
    const p = plan({ startMonth: "2026-03", endMonth: "2026-05" });
    expect(buildMonthEntries("2026-02", [p], [])).toHaveLength(0);
    expect(buildMonthEntries("2026-03", [p], [])).toHaveLength(1);
    expect(buildMonthEntries("2026-05", [p], [])).toHaveLength(1);
    expect(buildMonthEntries("2026-06", [p], [])).toHaveLength(0);
  });

  it("previsão confirmada não conta duas vezes", () => {
    const confirmed = tx({
      amount: "1500.00",
      planId: "p1",
      planMonth: "2026-03",
      occurredOn: "2026-03-10",
    });
    const entries = buildMonthEntries("2026-03", [plan()], [confirmed]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ source: "lancamento", recurring: true });
  });

  it("ordena por data", () => {
    const entries = buildMonthEntries("2026-03", [plan()], [tx()]);
    expect(entries.map((e) => e.date)).toEqual(["2026-03-05", "2026-03-10"]);
  });
});

describe("resumo do mês", () => {
  it("separa realizado de previsto e projeta o saldo", () => {
    const entries = buildMonthEntries(
      "2026-03",
      [plan()],
      [
        tx({ id: "r1", kind: "receita", amount: "5000.00", status: "realizado" }),
        tx({ id: "d1", amount: "200.10" }),
        tx({ id: "d2", amount: "99.90", status: "previsto" }),
      ],
    );
    expect(summarizeMonth(entries)).toEqual({
      received: "5000.00",
      spent: "200.10",
      balance: "4799.90",
      plannedIncome: "0.00",
      plannedExpense: "1599.90",
      projectedBalance: "3200.00",
    });
  });

  it("agrupa despesas por categoria, da maior para a menor", () => {
    const entries = buildMonthEntries(
      "2026-03",
      [plan()],
      [tx(), tx({ id: "t2", amount: "0.90" })],
    );
    expect(expensesByCategory(entries)).toEqual([
      { categoryId: "moradia", amount: "1500.00" },
      { categoryId: "mercado", amount: "201.00" },
    ]);
  });

  it("invariante: saldo projetado = receitas − despesas de tudo, sem erro de centavo", () => {
    const item = fc.record({
      cents: fc.integer({ min: 1, max: 10_000_000 }),
      income: fc.boolean(),
      done: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(item, { maxLength: 60 }), (items) => {
        const txs = items.map((it, i) =>
          tx({
            id: String(i),
            amount: (it.cents / 100).toFixed(2),
            kind: it.income ? "receita" : "despesa",
            status: it.done ? "realizado" : "previsto",
          }),
        );
        const expected = items.reduce((acc, it) => acc + (it.income ? it.cents : -it.cents), 0);
        const got = summarizeMonth(buildMonthEntries("2026-03", [], txs)).projectedBalance;
        return Math.round(Number(got) * 100) === expected;
      }),
    );
  });
});
