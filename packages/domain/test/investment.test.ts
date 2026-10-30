import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  isUnitPriced,
  money,
  netDividend,
  positionOf,
  redemptionOf,
  summarizeDividends,
  summarizePortfolio,
  type TradeInput,
} from "../src";

const buy = (occurredOn: string, quantity: string, unitPrice: string, fees = "0"): TradeInput => ({
  side: "compra",
  occurredOn,
  quantity,
  unitPrice,
  fees,
});
const sell = (occurredOn: string, quantity: string, unitPrice: string, fees = "0"): TradeInput => ({
  ...buy(occurredOn, quantity, unitPrice, fees),
  side: "venda",
});

describe("preço médio", () => {
  it("compras somam custo e taxas", () => {
    // 100 × 10 + 5 de taxa + 100 × 12 = 2205 / 200 = 11,025
    const position = positionOf([
      buy("2026-01-10", "100", "10", "5"),
      buy("2026-02-10", "100", "12"),
    ]);
    expect(position).toMatchObject({ quantity: "200", averagePrice: "11.025", cost: "2205.00" });
  });

  it("venda não muda o preço médio e apura o resultado", () => {
    const position = positionOf([
      buy("2026-01-10", "100", "10"),
      buy("2026-02-10", "100", "20"),
      sell("2026-03-10", "50", "25", "1"),
    ]);
    expect(position.averagePrice).toBe("15");
    expect(position.quantity).toBe("150");
    expect(position.cost).toBe("2250.00");
    // 50 × 25 − 1 − 50 × 15
    expect(position.realized).toBe("499.00");
  });

  it("ordena por data, com a compra antes da venda no mesmo dia", () => {
    const position = positionOf([sell("2026-03-10", "10", "12"), buy("2026-03-10", "10", "10")]);
    expect(position).toMatchObject({ quantity: "0", oversold: false, realized: "20.00" });
  });

  it("marca venda maior que a posição, sem deixar negativo", () => {
    const position = positionOf([buy("2026-01-10", "10", "10"), sell("2026-02-10", "15", "10")]);
    expect(position).toMatchObject({ quantity: "0", oversold: true, cost: "0.00" });
  });

  it("recompra depois de zerar começa do zero", () => {
    const position = positionOf([
      buy("2026-01-10", "10", "10"),
      sell("2026-02-10", "10", "10"),
      buy("2026-03-10", "10", "30"),
    ]);
    expect(position.averagePrice).toBe("30");
  });

  it("nunca tem quantidade ou custo negativos", () => {
    const trade = fc.record({
      side: fc.constantFrom("compra" as const, "venda" as const),
      occurredOn: fc.constantFrom("2026-01-01", "2026-02-01", "2026-03-01"),
      quantity: fc.integer({ min: 1, max: 5000 }).map(String),
      unitPrice: fc.integer({ min: 0, max: 900 }).map(String),
      fees: fc.integer({ min: 0, max: 20 }).map(String),
    });
    fc.assert(
      fc.property(fc.array(trade, { maxLength: 30 }), (trades) => {
        const position = positionOf(trades);
        expect(money(position.quantity).gte(0)).toBe(true);
        expect(money(position.cost).gte(0)).toBe(true);
      }),
    );
  });
});

describe("resgate sem preço unitário", () => {
  it("baixa o aplicado na proporção do valor atual", () => {
    const out = redemptionOf("1000", "1100", "550");
    expect(out.remaining).toBe("550.00");
    expect(out.unitPrice).toBe("1.1");
    expect(out.quantity).toBe("500");
    const position = positionOf([
      buy("2026-01-10", "1000", "1"),
      sell("2026-02-10", out.quantity, out.unitPrice),
    ]);
    expect(position).toMatchObject({ cost: "500.00", realized: "50.00", oversold: false });
  });

  it("resgate total zera a posição", () => {
    const out = redemptionOf("1000", "1100", "1120");
    expect(out).toEqual({ quantity: "1000", unitPrice: "1.12", remaining: "0.00" });
  });
});

describe("carteira", () => {
  const list = [
    {
      id: "a",
      assetClass: "acao",
      currentPrice: "12",
      currentValue: null,
      trades: [buy("2026-01-10", "100", "10")],
    },
    {
      id: "b",
      assetClass: "renda_fixa",
      currentPrice: null,
      currentValue: "3300",
      trades: [buy("2026-01-10", "3000", "1")],
    },
    {
      id: "c",
      assetClass: "fii",
      currentPrice: null,
      currentValue: null,
      trades: [buy("2026-01-10", "10", "50")],
    },
  ];

  it("soma valor, custo e resultado", () => {
    const summary = summarizePortfolio(list);
    expect(summary.total).toBe("5000.00");
    expect(summary.cost).toBe("4500.00");
    expect(summary.gain).toBe("500.00");
    expect(summary.gainPercent).toBe(11.1);
    expect(summary.rows[2]).toMatchObject({ value: "500.00", estimated: true, gain: "0.00" });
  });

  it("compara cada classe com a meta", () => {
    const summary = summarizePortfolio(list, [
      { assetClass: "renda_fixa", percent: "50" },
      { assetClass: "exterior", percent: "10" },
    ]);
    const of = (name: string) => summary.classes.find((c) => c.assetClass === name)!;
    expect(of("renda_fixa")).toMatchObject({ percent: 66, target: 50, toTarget: "-800.00" });
    expect(of("exterior")).toMatchObject({ value: "0.00", toTarget: "500.00" });
    expect(of("acao").toTarget).toBeNull();
  });

  it("posição zerada não vale nada, mesmo com preço", () => {
    const summary = summarizePortfolio([
      {
        id: "a",
        assetClass: "acao",
        currentPrice: "12",
        currentValue: null,
        trades: [buy("2026-01-10", "10", "10"), sell("2026-02-10", "10", "11")],
      },
    ]);
    expect(summary.total).toBe("0.00");
    expect(summary.realized).toBe("10.00");
    expect(summary.classes).toEqual([]);
  });

  it("sabe quais classes têm preço unitário", () => {
    expect(isUnitPriced("fii")).toBe(true);
    expect(isUnitPriced("previdencia")).toBe(false);
  });
});

describe("proventos", () => {
  const rows = [
    { investmentId: "a", kind: "jcp" as const, paidOn: "2026-10-15", gross: "100", withheld: "15" },
    {
      investmentId: "b",
      kind: "rendimento" as const,
      paidOn: "2026-02-15",
      gross: "120",
      withheld: "0",
    },
    {
      investmentId: "a",
      kind: "dividendo" as const,
      paidOn: "2025-11-20",
      gross: "50",
      withheld: "0",
    },
    {
      investmentId: "a",
      kind: "dividendo" as const,
      paidOn: "2025-10-31",
      gross: "999",
      withheld: "0",
    },
  ];

  it("usa o valor líquido", () => {
    expect(netDividend(rows[0]!)).toBe("85.00");
  });

  it("resume os últimos 12 meses e o ano", () => {
    const summary = summarizeDividends(rows, "2026-10", "100");
    expect(summary.months).toHaveLength(12);
    expect(summary.months[0]).toEqual({ month: "2025-11", net: "50.00" });
    expect(summary.months[11]).toEqual({ month: "2026-10", net: "85.00" });
    expect(summary.last12).toBe("255.00");
    expect(summary.monthlyAverage).toBe("21.25");
    expect(summary.thisYear).toBe("205.00");
    expect(summary.withheld12).toBe("15.00");
    expect(summary.goalPercent).toBe(21);
    expect(summary.byInvestment[0]).toEqual({ investmentId: "a", net: "135.00" });
  });

  it("não inventa meta", () => {
    expect(summarizeDividends([], "2026-10", null).goalPercent).toBeNull();
  });
});
