import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  availableToAllocate,
  investedByMonth,
  investingHabit,
  NO_SAVINGS,
  forecastSurplus,
  monthlySeries,
  monthlySurplus,
  type MonthPoint,
  type TransactionInput,
} from "../src";

// Pontos como `monthlySeries` devolve: meses fechados com receitas e despesas realizadas.
const point = (month: string, received: number, spent: number): MonthPoint => ({
  month,
  received: received.toFixed(2),
  spent: spent.toFixed(2),
  balance: (received - spent).toFixed(2),
  contributed: "0.00",
  redeemed: "0.00",
});

describe("excedente mensal", () => {
  it("com seis meses usa o menor entre média e mediana", () => {
    // Saldos 1000, 500, 2000, −200, 800, 700: média 800; mediana (700 + 800) / 2 = 750.
    const result = monthlySurplus([
      point("2026-04", 5000, 4000),
      point("2026-05", 5000, 4500),
      point("2026-06", 6000, 4000),
      point("2026-07", 4800, 5000),
      point("2026-08", 5000, 4200),
      point("2026-09", 5000, 4300),
    ]);
    expect(result).toEqual({
      average: "800.00",
      median: "750.00",
      usable: "750.00",
      months: 6,
      basis: "media_mediana",
    });
  });

  it("com três a cinco meses usa só a mediana", () => {
    const result = monthlySurplus([
      point("2026-07", 5000, 4000),
      point("2026-08", 5000, 1000),
      point("2026-09", 5000, 4500),
    ]);
    expect(result).toMatchObject({ median: "1000.00", usable: "1000.00", basis: "mediana" });
    expect(result.average).toBe("1833.33");
  });

  it("abaixo de três meses não há base", () => {
    const result = monthlySurplus([point("2026-08", 5000, 1000), point("2026-09", 5000, 4500)]);
    expect(result).toEqual({
      average: "0.00",
      median: "0.00",
      usable: "0.00",
      months: 2,
      basis: "sem_dados",
    });
  });

  it("mês sem nenhum lançamento não conta", () => {
    const result = monthlySurplus([
      point("2026-06", 0, 0),
      point("2026-07", 5000, 4000),
      point("2026-08", 5000, 4000),
      point("2026-09", 5000, 4000),
    ]);
    expect(result.months).toBe(3);
    expect(result.usable).toBe("1000.00");
  });

  it("o que a família guarda não conta como gasto", () => {
    const tx = (
      id: string,
      month: string,
      amount: string,
      categoryId: string,
    ): TransactionInput => ({
      id,
      kind: "despesa",
      description: "x",
      amount,
      occurredOn: `${month}-10`,
      status: "realizado",
      categoryId,
      accountId: "a",
      planId: null,
      planMonth: null,
    });
    const income = (id: string, month: string): TransactionInput => ({
      ...tx(id, month, "5000.00", "s"),
      kind: "receita",
    });
    const months = ["2026-07", "2026-08", "2026-09"];
    const base = months.flatMap((m, i) => [income(`r${i}`, m), tx(`d${i}`, m, "4000.00", "m")]);
    const withGoal = [
      ...base,
      tx("g", "2026-08", "700.00", "metas"),
      tx("c", "2026-09", "300.00", "x"),
    ];
    const rule = {
      ...NO_SAVINGS,
      goalCategories: new Set(["metas"]),
      goalTransactions: new Set(["c"]),
    };
    expect(monthlySurplus(monthlySeries(months, [], withGoal, rule))).toEqual(
      monthlySurplus(monthlySeries(months, [], base, NO_SAVINGS)),
    );
    expect(monthlySurplus(monthlySeries(months, [], withGoal, NO_SAVINGS)).usable).not.toBe(
      "1000.00",
    );
  });

  it("mede o que já é aportado por mês, sem pico, sem meta e sem ficar negativo", () => {
    const rule = {
      ...NO_SAVINGS,
      investmentCategories: new Set(["aportes"]),
      goalCategories: new Set(["metas"]),
    };
    const row = (id: string, month: string, amount: string, categoryId: string) => ({
      id,
      kind: "despesa" as const,
      description: "x",
      amount,
      occurredOn: `${month}-10`,
      status: "realizado" as const,
      categoryId,
      accountId: "a",
      planId: null,
      planMonth: null,
    });
    const months = ["2026-07", "2026-08", "2026-09"];
    const rows = [
      row("a", "2026-07", "1000.00", "aportes"),
      row("b", "2026-08", "1000.00", "aportes"),
      row("c", "2026-08", "700.00", "metas"),
      row("d", "2026-09", "9000.00", "aportes"),
      { ...row("e", "2026-09", "8000.00", "aportes"), kind: "receita" as const },
    ];
    const invested = investedByMonth(months, rows, rule);
    expect(invested).toEqual(["1000.00", "1000.00", "1000.00"]);
    const points = months.map((month) => point(month, 5000, 4000));
    expect(investingHabit(invested, points)).toBe("1000.00");
    // Um mês grande não vira compromisso: a mediana ignora o pico.
    expect(investingHabit(["0.00", "50000.00", "0.00"], points)).toBe("0.00");
    expect(investingHabit(["-500.00", "-500.00", "-500.00"], points)).toBe("0.00");
    // Menos de três meses não é hábito.
    expect(investingHabit(["1000.00", "1000.00"], points.slice(0, 2))).toBe("0.00");
  });

  it("o utilizável nunca passa da média nem da mediana com histórico cheio", () => {
    const month = fc.record({
      received: fc.integer({ min: 1, max: 2_000_000 }),
      spent: fc.integer({ min: 0, max: 2_000_000 }),
    });
    fc.assert(
      fc.property(fc.array(month, { minLength: 6, maxLength: 24 }), (rows) => {
        const result = monthlySurplus(
          rows.map((row, i) =>
            point(
              `2020-${String((i % 12) + 1).padStart(2, "0")}`,
              row.received / 100,
              row.spent / 100,
            ),
          ),
        );
        expect(result.basis).toBe("media_mediana");
        expect(Number(result.usable)).toBeLessThanOrEqual(Number(result.average) + 0.01);
        expect(Number(result.usable)).toBeLessThanOrEqual(Number(result.median) + 0.01);
      }),
    );
  });
});

describe("excedente previsto e disponível", () => {
  it("renda líquida menos previsões recorrentes", () => {
    expect(forecastSurplus("5000.00", "3500.00")).toBe("1500.00");
    expect(forecastSurplus("3000.00", "3500.00")).toBe("-500.00");
  });

  it("tira a folga e nunca fica negativo", () => {
    expect(availableToAllocate("1000.00")).toBe("900.00");
    expect(availableToAllocate("1000.00", 0)).toBe("1000.00");
    expect(availableToAllocate("-200.00")).toBe("0.00");
  });
});
