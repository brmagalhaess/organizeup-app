import { describe, expect, it } from "vitest";
import { monthlyChartState } from "./dividends-chart-state";

const months = (...nets: string[]) =>
  nets.map((net, index) => ({ month: `2026-${index + 1}`, net }));

describe("estado do gráfico mês a mês", () => {
  it("com valor em algum mês, mostra as barras", () => {
    expect(monthlyChartState(months("0.00", "12.50", "0.00"), 0)).toBe("barras");
    expect(monthlyChartState(months("0.01"), 3)).toBe("barras");
  });

  it("sem nada pago, mas com provento anunciado, avisa que está a receber", () => {
    expect(monthlyChartState(months("0.00", "0.00"), 2)).toBe("a_receber");
  });

  it("sem nada pago nem anunciado, fica vazio", () => {
    expect(monthlyChartState(months("0.00", "0.00"), 0)).toBe("vazio");
    expect(monthlyChartState([], 0)).toBe("vazio");
  });
});
