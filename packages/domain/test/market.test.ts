import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  entitledQuantity,
  jcpRateOf,
  marketDateOf,
  money,
  normalizeTicker,
  paidRate,
  proventoAmounts,
  quoteApplies,
  quoteStateOf,
  receivedDividends,
  reconcileProventos,
  summarizeDividends,
  upcomingDividends,
  type ExistingDividend,
  type MarketProvento,
  type ReconcileInput,
  type TradeInput,
} from "../src";

const buy = (occurredOn: string, quantity: string): TradeInput => ({
  side: "compra",
  occurredOn,
  quantity,
  unitPrice: "10",
  fees: "0",
});
const sell = (occurredOn: string, quantity: string): TradeInput => ({
  ...buy(occurredOn, quantity),
  side: "venda",
});
const event = (over: Partial<MarketProvento> = {}): MarketProvento => ({
  id: "m1",
  kind: "dividendo",
  comDate: "2026-08-21",
  payDate: "2026-12-21",
  ratePerShare: "0.47156696",
  ...over,
});
const input = (over: Partial<ReconcileInput> = {}): ReconcileInput => ({
  assetClass: "acao",
  trades: [buy("2026-01-05", "100")],
  events: [event()],
  existing: [],
  blocked: new Set(),
  ...over,
});
const row = (over: Partial<ExistingDividend> = {}): ExistingDividend => ({
  id: "d1",
  kind: "dividendo",
  paidOn: "2026-12-21",
  gross: "47.16",
  withheld: "0.00",
  source: "agente",
  marketDividendId: "m1",
  ...over,
});

describe("normalizeTicker", () => {
  it("aceita ações, FIIs, ETFs e BDRs e tira o F do fracionário", () => {
    expect(normalizeTicker(" petr4 ")).toBe("PETR4");
    expect(normalizeTicker("HGLG11")).toBe("HGLG11");
    expect(normalizeTicker("AAPL34")).toBe("AAPL34");
    expect(normalizeTicker("PETR4F")).toBe("PETR4");
  });

  it("recusa o que não é código da B3, como um nome digitado no campo", () => {
    expect(normalizeTicker("JOAO")).toBeNull();
    expect(normalizeTicker("TESOURO2031")).toBeNull();
    expect(normalizeTicker(null)).toBeNull();
    expect(normalizeTicker("")).toBeNull();
  });
});

describe("marketDateOf", () => {
  it("usa a data civil da B3, não a de UTC", () => {
    // Formato real da brapi: meia-noite em Brasília.
    expect(marketDateOf("2026-08-21T03:00:00.000Z")).toBe("2026-08-21");
    expect(marketDateOf("2026-08-22T02:59:00.000Z")).toBe("2026-08-21");
  });
});

describe("entitledQuantity", () => {
  it("compra na data-com tem direito; compra na data ex, não", () => {
    const trades = [buy("2026-08-21", "10"), buy("2026-08-24", "5")];
    expect(entitledQuantity(trades, "2026-08-21")).toBe("10");
  });

  it("venda na data-com tira o direito daquelas ações", () => {
    const trades = [buy("2026-01-05", "10"), sell("2026-08-21", "4")];
    expect(entitledQuantity(trades, "2026-08-21")).toBe("6");
    expect(entitledQuantity(trades, "2026-08-20")).toBe("10");
  });

  it("não vê operação futura", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        (before, after) => {
          const trades = [buy("2026-03-01", String(before)), buy("2026-09-01", String(after))];
          return entitledQuantity(trades, "2026-08-21") === String(before);
        },
      ),
    );
  });

  describe("com eventos em ações", () => {
    const trades = [buy("2026-01-05", "100")];
    const split = { comDate: "2026-03-12", factor: "2" };

    it("provento antes do evento vai para a quantidade antiga", () => {
      expect(entitledQuantity(trades, "2026-02-20", [split])).toBe("100");
    });

    it("provento na data-com do evento vai para as ações de antes dele", () => {
      expect(entitledQuantity(trades, "2026-03-12", [split])).toBe("100");
    });

    it("provento depois do evento vai para a quantidade nova", () => {
      expect(entitledQuantity(trades, "2026-03-13", [split])).toBe("200");
    });

    it("soma compra na data do provento à quantidade já ajustada", () => {
      const more = [...trades, buy("2026-05-20", "10")];
      expect(entitledQuantity(more, "2026-05-20", [split])).toBe("210");
    });
  });
});

describe("paidRate", () => {
  // Fixture real: ITUB4, JCP mensal com data-com 28/11/2025. A brapi traz 0,01713592233 depois da
  // bonificação de 3% com data-com 23/12/2025; o valor pago foi R$ 0,015 líquido a 15%.
  const bonus = [{ comDate: "2025-12-23", factor: "1.03" }];

  it("desfaz o ajuste da fonte quando o evento em ações veio depois", () => {
    expect(paidRate("0.01713592233", "2025-11-28", bonus)).toBe("0.01765000");
    expect(money("0.01765").times("0.85").toDecimalPlaces(5).toString()).toBe("0.015");
  });

  it("não mexe em provento depois do evento", () => {
    expect(paidRate("0.018182", "2025-12-30", bonus)).toBe("0.01818200");
  });

  it("evento na própria data-com conta", () => {
    expect(paidRate("1", "2025-12-23", bonus)).toBe("1.03000000");
  });

  it("aplica grupamento, que reduz o número de ações", () => {
    expect(paidRate("0.29", "2024-05-01", [{ comDate: "2024-05-24", factor: "0.1" }])).toBe(
      "0.02900000",
    );
  });
});

describe("jcpRateOf", () => {
  // Lei Complementar 224/2025, art. 8º e art. 14, III: 17,5% desde 01/01/2026. Fixture real: ITUB4
  // anuncia JCP bruto de 0,018182 com data-com em 2026, que dá 0,015 líquido só a 17,5%.
  it("17,5% com data-com a partir de 2026", () => {
    expect(jcpRateOf("2026-01-30", "2026-03-02")).toBe("0.175");
    expect(money("0.018182").times(money(1).minus("0.175")).toDecimalPlaces(5).toString()).toBe(
      "0.015",
    );
  });

  it("15% quando crédito e pagamento ficaram em 2025", () => {
    expect(jcpRateOf("2025-10-31", "2025-12-01")).toBe("0.15");
  });

  it("não decide na virada: data-com em 2025 e pagamento em 2026", () => {
    // Na fonte há os dois casos: ITUB4 de 28/11/2025 pago em 02/01/2026 saiu a 15%, e o de
    // 30/12/2025 pago em 02/02/2026 saiu a 17,5%. Quem decide é a data do crédito, que não vem.
    expect(jcpRateOf("2025-12-30", "2026-02-02")).toBeNull();
    expect(jcpRateOf("2025-11-28", "2026-01-02")).toBeNull();
  });
});

describe("proventoAmounts", () => {
  const base = {
    assetClass: "acao",
    kind: "jcp" as const,
    quantity: "100",
    ratePerShare: "0.67407131",
    comDate: "2026-08-21",
    payDate: "2026-11-23",
  };

  it("JCP retém 17,5% e dividendo não retém", () => {
    // Fixture real: PETR4, JCP de 0,67407131 com data-com 21/08/2026.
    expect(proventoAmounts(base)).toEqual({ gross: "67.41", withheld: "11.80" });
    expect(proventoAmounts({ ...base, kind: "dividendo", ratePerShare: "0.47156696" })).toEqual({
      gross: "47.16",
      withheld: "0.00",
    });
  });

  it("rendimento de FII não retém", () => {
    expect(
      proventoAmounts({ ...base, assetClass: "fii", kind: "rendimento", ratePerShare: "1.17" }),
    ).toEqual({ gross: "117.00", withheld: "0.00" });
  });

  it("não calcula quando o imposto é incerto", () => {
    expect(proventoAmounts({ ...base, comDate: "2025-12-30", payDate: "2026-02-02" })).toEqual({
      skip: "imposto_incerto",
    });
    expect(proventoAmounts({ ...base, kind: "rendimento" })).toEqual({ skip: "imposto_incerto" });
  });

  it("não cria provento que não chega a um centavo", () => {
    expect(proventoAmounts({ ...base, quantity: "0.001", ratePerShare: "0.01" })).toEqual({
      skip: "abaixo_de_um_centavo",
    });
  });

  it("retido nunca passa do bruto", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.constantFrom("jcp", "dividendo") as fc.Arbitrary<"jcp" | "dividendo">,
        (quantity, rate, kind) => {
          const amounts = proventoAmounts({
            ...base,
            kind,
            quantity: String(quantity),
            ratePerShare: money(rate).dividedBy(100_000_000).toFixed(8),
          });
          if ("skip" in amounts) return true;
          return money(amounts.withheld).lte(amounts.gross) && money(amounts.gross).gt(0);
        },
      ),
    );
  });
});

describe("reconcileProventos", () => {
  it("cria o provento de quem tinha posição na data-com", () => {
    expect(reconcileProventos(input()).create).toEqual([
      {
        marketDividendId: "m1",
        kind: "dividendo",
        paidOn: "2026-12-21",
        gross: "47.16",
        withheld: "0.00",
      },
    ]);
  });

  it("ignora quem comprou depois da data-com", () => {
    const plan = reconcileProventos(input({ trades: [buy("2026-08-24", "100")] }));
    expect(plan.create).toEqual([]);
  });

  it("rodar de novo sobre o resultado não muda nada", () => {
    const first = reconcileProventos(input());
    const second = reconcileProventos(
      input({
        existing: first.create.map((entry, index) => ({
          ...entry,
          id: `d${index}`,
          source: "agente" as const,
        })),
      }),
    );
    expect(second).toEqual({ create: [], update: [], remove: [], skippedFamily: 0, skippedTax: 0 });
  });

  it("respeita o que a família desfez ou excluiu", () => {
    const plan = reconcileProventos(input({ blocked: new Set(["m1"]) }));
    expect(plan.create).toEqual([]);
    expect(reconcileProventos(input({ blocked: new Set(["m1"]), existing: [row()] }))).toEqual({
      create: [],
      update: [],
      remove: [],
      skippedFamily: 0,
      skippedTax: 0,
    });
  });

  it("não duplica provento que a família já lançou à mão", () => {
    const typed = row({ source: "familia", marketDividendId: null, paidOn: "2026-12-23" });
    const plan = reconcileProventos(input({ existing: [typed] }));
    expect(plan.create).toEqual([]);
    expect(plan.skippedFamily).toBe(1);
    const far = row({ source: "familia", marketDividendId: null, paidOn: "2026-11-23" });
    expect(reconcileProventos(input({ existing: [far] })).create).toHaveLength(1);
  });

  it("corrige o valor quando a operação muda e tira quando a posição some", () => {
    const stale = row({ gross: "23.58" });
    expect(reconcileProventos(input({ existing: [stale] })).update).toEqual([
      { id: "d1", marketDividendId: "m1", gross: "47.16", withheld: "0.00" },
    ]);
    const gone = reconcileProventos(
      input({ existing: [stale], trades: [buy("2026-09-01", "100")] }),
    );
    expect(gone.remove).toEqual([stale]);
  });

  it("tira a linha automática quando o ticker do investimento mudou", () => {
    const plan = reconcileProventos(input({ events: [], existing: [row()] }));
    expect(plan.remove).toHaveLength(1);
  });

  it("dividendo acima de R$ 50 mil no mês fica para a família conferir", () => {
    // Lei 15.270/2025: mais de R$ 50 mil no mês da mesma empresa retém 10% do total, por pessoa.
    const plan = reconcileProventos(
      input({ trades: [buy("2026-01-05", "200000")], events: [event({ ratePerShare: "0.5" })] }),
    );
    expect(plan.create).toEqual([]);
    expect(plan.skippedTax).toBe(1);
  });

  it("JCP da virada de ano fica de fora e é contado", () => {
    const plan = reconcileProventos(
      input({
        trades: [buy("2025-01-05", "100")],
        events: [event({ kind: "jcp", comDate: "2025-12-30", payDate: "2026-02-02" })],
      }),
    );
    expect(plan.create).toEqual([]);
    expect(plan.skippedTax).toBe(1);
  });

  it("nunca cria duas linhas para o mesmo provento", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.boolean(), (quantity, repeated) => {
        const base = input({ trades: [buy("2026-01-05", String(quantity))] });
        const first = reconcileProventos(base);
        const existing = repeated
          ? first.create.map((entry) => ({ ...entry, id: "x", source: "agente" as const }))
          : [];
        const created = reconcileProventos({ ...base, existing }).create;
        return created.length === (repeated ? 0 : first.create.length);
      }),
    );
  });
});

describe("quoteApplies", () => {
  const base = {
    priceSource: "familia" as const,
    currentPrice: "30",
    valuedOn: "2026-10-30",
    quotePrice: "31",
    quoteDate: "2026-10-31",
  };

  it("cotação mais nova entra por cima do preço da família", () => {
    expect(quoteApplies(base)).toBe(true);
  });

  it("preço digitado na data da cotação ou depois fica", () => {
    expect(quoteApplies({ ...base, valuedOn: "2026-10-31" })).toBe(false);
    expect(quoteApplies({ ...base, valuedOn: "2026-11-02" })).toBe(false);
  });

  it("sem preço informado, entra", () => {
    expect(quoteApplies({ ...base, currentPrice: null, valuedOn: null })).toBe(true);
  });

  it("preço automático só muda com cotação nova ou diferente", () => {
    const automatic = { ...base, priceSource: "mercado" as const, valuedOn: "2026-10-31" };
    expect(quoteApplies({ ...automatic, currentPrice: "31" })).toBe(false);
    expect(quoteApplies(automatic)).toBe(true);
    expect(quoteApplies({ ...automatic, quoteDate: "2026-10-30" })).toBe(false);
  });
});

describe("quoteStateOf", () => {
  const base = {
    assetClass: "acao",
    ticker: "PETR4",
    priceSource: "familia" as const,
    hasQuote: false,
    tickerStatus: null,
  };

  it("cobre cada caso da tela", () => {
    expect(quoteStateOf({ ...base, assetClass: "renda_fixa" })).toBe("nao_se_aplica");
    expect(quoteStateOf({ ...base, ticker: null })).toBe("sem_ticker");
    expect(quoteStateOf({ ...base, ticker: "JOAO" })).toBe("ticker_invalido");
    expect(quoteStateOf({ ...base, tickerStatus: "desconhecido" })).toBe("ticker_invalido");
    expect(quoteStateOf(base)).toBe("aguardando");
    expect(quoteStateOf({ ...base, tickerStatus: "sem_plano" })).toBe("sem_plano");
    expect(quoteStateOf({ ...base, hasQuote: true })).toBe("informado");
    expect(quoteStateOf({ ...base, hasQuote: true, priceSource: "mercado" })).toBe("automatico");
  });
});

describe("a receber", () => {
  const rows = [
    {
      investmentId: "a",
      kind: "dividendo" as const,
      paidOn: "2026-10-10",
      gross: "10.00",
      withheld: "0.00",
    },
    {
      investmentId: "a",
      kind: "dividendo" as const,
      paidOn: "2026-10-31",
      gross: "20.00",
      withheld: "0.00",
    },
    {
      investmentId: "a",
      kind: "jcp" as const,
      paidOn: "2026-12-21",
      gross: "40.00",
      withheld: "7.00",
    },
    {
      investmentId: "a",
      kind: "jcp" as const,
      paidOn: "2026-11-01",
      gross: "30.00",
      withheld: "5.25",
    },
  ];

  it("pagamento de hoje já é recebido; o resto é a receber, do mais próximo ao mais distante", () => {
    expect(receivedDividends(rows, "2026-10-31")).toHaveLength(2);
    expect(upcomingDividends(rows, "2026-10-31").map((r) => r.paidOn)).toEqual([
      "2026-11-01",
      "2026-12-21",
    ]);
  });

  it("o que é a receber fica fora do total de 12 meses, mesmo no mês corrente", () => {
    const summary = summarizeDividends(receivedDividends(rows, "2026-10-15"), "2026-10", null);
    expect(summary.last12).toBe("10.00");
  });
});
