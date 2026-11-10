import { describe, expect, it } from "vitest";
import { monthlyChartState } from "./dividends-chart-state";

const month = (paid: string, announced = "0.00") => ({ paid, announced });

describe("estado do gráfico mês a mês", () => {
  it("com valor pago em algum mês, mostra as barras", () => {
    expect(monthlyChartState([month("0.00"), month("12.50"), month("0.00")])).toBe("barras");
  });

  it("só anunciado também mostra as barras", () => {
    expect(monthlyChartState([month("0.00", "0.00"), month("0.00", "30.00")])).toBe("barras");
  });

  it("sem nada pago nem anunciado, fica vazio", () => {
    expect(monthlyChartState([month("0.00"), month("0.00")])).toBe("vazio");
    expect(monthlyChartState([])).toBe("vazio");
  });
});
