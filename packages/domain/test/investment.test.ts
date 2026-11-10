import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  isUnitPriced,
  money,
  netDividend,
  positionOf,
  redemptionOf,
  dividendMonths,
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

describe("eventos em ações", () => {
  const split = { comDate: "2026-03-12", factor: "2" };

  it("desdobramento multiplica a quantidade, mantém o custo e divide o preço médio", () => {
    const position = positionOf([buy("2026-01-10", "100", "30", "10")], [split]);
    expect(position).toMatchObject({ quantity: "200", cost: "3010.00", averagePrice: "15.05" });
  });

  it("grupamento de 10 para 1 divide a quantidade", () => {
    const position = positionOf(
      [buy("2026-01-10", "100", "3")],
      [{ comDate: "2026-03-12", factor: "0.1" }],
    );
    expect(position).toMatchObject({ quantity: "10", cost: "300.00", averagePrice: "30" });
  });

  it("bonificação de 3% acrescenta ações sem mudar o custo", () => {
    // Fixture real: ITUB4, bonificação de 3% com data-com 23/12/2025 (ADR-0017).
    const position = positionOf(
      [buy("2025-06-10", "100", "30")],
      [{ comDate: "2025-12-23", factor: "1.03" }],
    );
    expect(position).toMatchObject({ quantity: "103", cost: "3000.00" });
  });

  it("compra na própria data-com tem direito; compra no dia seguinte, não", () => {
    expect(positionOf([buy("2026-03-12", "10", "30")], [split]).quantity).toBe("20");
    expect(positionOf([buy("2026-03-13", "10", "15")], [split]).quantity).toBe("10");
  });

  it("venda na data-com sai antes do evento, mesmo fora de ordem na lista", () => {
    const position = positionOf(
      [sell("2026-03-12", "40", "30"), buy("2026-01-10", "100", "30")],
      [split],
    );
    expect(position).toMatchObject({ quantity: "120", cost: "1800.00", oversold: false });
  });

  it("venda depois do evento conta na quantidade nova e usa o preço médio novo", () => {
    const position = positionOf(
      [buy("2026-01-10", "100", "30"), sell("2026-04-01", "150", "20")],
      [split],
    );
    expect(position).toMatchObject({
      quantity: "50",
      averagePrice: "15",
      cost: "750.00",
      realized: "750.00",
      oversold: false,
    });
  });

  it("dois eventos seguidos se acumulam, com compra no meio", () => {
    const position = positionOf(
      [buy("2026-01-10", "100", "30"), buy("2026-05-01", "10", "15")],
      [{ comDate: "2026-06-01", factor: "1.1" }, split],
    );
    // 100 × 2 = 200; + 10 = 210; × 1,1 = 231.
    expect(position).toMatchObject({ quantity: "231", cost: "3150.00" });
  });

  it("sem evento fica tudo como antes; sem posição, o evento não cria ações", () => {
    const trades = [buy("2026-01-10", "100", "30")];
    expect(positionOf(trades, [])).toEqual(positionOf(trades));
    expect(positionOf([], [split]).quantity).toBe("0");
  });

  it("a carteira usa os eventos do investimento", () => {
    const summary = summarizePortfolio([
      {
        id: "a",
        assetClass: "acao",
        currentPrice: "15",
        currentValue: null,
        trades: [buy("2026-01-10", "100", "30")],
        events: [split],
      },
    ]);
    expect(summary.rows[0]!.position.quantity).toBe("200");
    expect(summary.total).toBe("3000.00");
    expect(summary.cost).toBe("3000.00");
  });

  it("desdobrar não muda o custo e multiplica a quantidade", () => {
    const trade = fc.record({
      side: fc.constant("compra" as const),
      occurredOn: fc.constantFrom("2026-01-01", "2026-02-01", "2026-03-12"),
      quantity: fc.integer({ min: 1, max: 5000 }).map(String),
      unitPrice: fc.integer({ min: 1, max: 900 }).map(String),
      fees: fc.integer({ min: 0, max: 20 }).map(String),
    });
    fc.assert(
      fc.property(
        fc.array(trade, { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 2, max: 20 }),
        (trades, factor) => {
          const before = positionOf(trades);
          const after = positionOf(trades, [{ comDate: "2026-03-12", factor: String(factor) }]);
          expect(after.cost).toBe(before.cost);
          expect(after.realized).toBe(before.realized);
          expect(money(after.quantity).eq(money(before.quantity).times(factor))).toBe(true);
        },
      ),
    );
  });

  it("vendas no meio não mudam o custo que fica: desdobrar e vender o mesmo pedaço dá no mesmo", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 2, max: 20 }),
        (quantity, soldRaw, factor) => {
          const sold = Math.min(soldRaw, quantity);
          const old = positionOf([
            buy("2026-01-10", String(quantity), "30"),
            sell("2026-03-01", String(sold), "30"),
          ]);
          const split = positionOf(
            [
              buy("2026-01-10", String(quantity), "30"),
              sell("2026-04-01", String(sold * factor), "15"),
            ],
            [{ comDate: "2026-03-12", factor: String(factor) }],
          );
          expect(split.cost).toBe(old.cost);
          expect(money(split.quantity).eq(money(old.quantity).times(factor))).toBe(true);
        },
      ),
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

  describe("mês a mês, pago e anunciado", () => {
    const today = "2026-10-20";
    const announced = [
      ...rows,
      { investmentId: "a", kind: "jcp" as const, paidOn: "2026-10-28", gross: "40", withheld: "7" },
      {
        investmentId: "b",
        kind: "dividendo" as const,
        paidOn: "2026-12-05",
        gross: "30",
        withheld: "0",
      },
    ];

    it("12 meses: do mês de há 11 meses até o atual, e o anunciado no mesmo mês", () => {
      const months = dividendMonths(announced, today, "12m");
      expect(months[0]).toEqual({ month: "2025-11", paid: "50.00", announced: "0.00" });
      expect(months.find((m) => m.month === "2026-10")).toEqual({
        month: "2026-10",
        paid: "85.00",
        announced: "33.00",
      });
      // O anunciado de dezembro estende o gráfico até lá; novembro fica vazio.
      expect(months.map((m) => m.month).slice(-3)).toEqual(["2026-10", "2026-11", "2026-12"]);
      expect(months.at(-1)).toEqual({ month: "2026-12", paid: "0.00", announced: "30.00" });
      expect(months).toHaveLength(14);
    });

    it("ano: de janeiro até o mês atual", () => {
      const months = dividendMonths(rows, today, "ano");
      expect(months.map((m) => m.month)).toEqual([
        "2026-01",
        "2026-02",
        "2026-03",
        "2026-04",
        "2026-05",
        "2026-06",
        "2026-07",
        "2026-08",
        "2026-09",
        "2026-10",
      ]);
      expect(months[1]).toEqual({ month: "2026-02", paid: "120.00", announced: "0.00" });
    });

    it("desde o início: do mês do primeiro ativo; sem início, vale 12 meses", () => {
      expect(dividendMonths(rows, today, "inicio", "2025-06")[0]!.month).toBe("2025-06");
      expect(dividendMonths(rows, today, "inicio", "2025-06")).toHaveLength(17);
      expect(dividendMonths(rows, today, "inicio", null)[0]!.month).toBe("2025-11");
      // Início depois do mês atual não faz sentido: cai nos 12 meses.
      expect(dividendMonths(rows, today, "inicio", "2027-01")[0]!.month).toBe("2025-11");
    });

    it("anunciado muito à frente fica de fora do eixo", () => {
      const far = [
        {
          investmentId: "a",
          kind: "dividendo" as const,
          paidOn: "2028-01-10",
          gross: "1",
          withheld: "0",
        },
      ];
      expect(dividendMonths(far, today, "12m").at(-1)!.month).toBe("2026-10");
    });
  });

  it("não inventa meta", () => {
    expect(summarizeDividends([], "2026-10", null).goalPercent).toBeNull();
  });
});
