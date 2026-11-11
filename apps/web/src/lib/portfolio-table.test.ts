import { describe, expect, it } from "vitest";
import { tableCells, tableTotals, type TableInput } from "./portfolio-table";

const base: TableInput = {
  value: "3000.00",
  currentPrice: "30.00000000",
  bookValuePerShare: "25.00000000",
  targetPrice: "36.00000000",
  targetPercent: "40.00",
  dividends12: "240.00",
  position: { quantity: "100", averagePrice: "28", cost: "2800.00" },
};

describe("tabela da carteira", () => {
  it("P/VP, potencial, dividendo por mês, fatia e aporte necessário", () => {
    const cells = tableCells(base, "10000.00");
    expect(cells).toEqual({
      priceToBook: 1.2,
      upside: 20,
      dividendMonthly: "20.00",
      idealPercent: 40,
      contribution: "1000.00",
      sharePercent: 30,
    });
  });

  it("sem VPA, preço alvo ou meta, as colunas ficam em branco", () => {
    const cells = tableCells(
      { ...base, bookValuePerShare: null, targetPrice: null, targetPercent: null },
      "10000.00",
    );
    expect(cells).toMatchObject({ priceToBook: null, upside: null, contribution: null });
    expect(cells.idealPercent).toBeNull();
  });

  it("sem preço atual não há P/VP nem potencial", () => {
    const cells = tableCells({ ...base, currentPrice: null }, "10000.00");
    expect(cells).toMatchObject({ priceToBook: null, upside: null });
  });

  it("potencial negativo quando o preço já passou do alvo; aporte nunca negativo", () => {
    const cells = tableCells(
      { ...base, targetPrice: "27.00000000", targetPercent: "10.00" },
      "10000.00",
    );
    expect(cells.upside).toBe(-10);
    expect(cells.contribution).toBe("0.00");
  });

  it("carteira vazia não divide por zero", () => {
    const cells = tableCells({ ...base, value: "0.00", dividends12: null }, "0.00");
    expect(cells).toMatchObject({ sharePercent: 0, dividendMonthly: "0.00", contribution: "0.00" });
  });

  it("totais somam o que está nas linhas", () => {
    const rows = [
      { ...base, gain: "200.00" },
      { ...base, value: "7000.00", targetPercent: "50.00", dividends12: null, gain: "-100.00" },
    ];
    const cells = rows.map((row) => tableCells(row, "10000.00"));
    expect(tableTotals(rows, cells)).toEqual({
      value: "10000.00",
      cost: "5600.00",
      gain: "100.00",
      dividendMonthly: "20.00",
      idealPercent: 90,
      contribution: "1000.00",
    });
  });
});
