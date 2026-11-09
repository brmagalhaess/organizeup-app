// Fontes gratuitas de mercado (ADR-0032), com respostas gravadas em 2026-11-09.
import { describe, expect, it } from "vitest";
import { b3FundIdentifier, fetchB3FiiDividends, fetchYahooQuote, MarketError } from "../src/market";

const yahooBody = {
  chart: {
    result: [
      {
        meta: {
          currency: "BRL",
          symbol: "MXRF11.SA",
          exchangeName: "SAO",
          regularMarketPrice: 8.8,
          regularMarketTime: 1793998980,
          chartPreviousClose: 8.75,
        },
        timestamp: [1793998980],
        indicators: { quote: [{ close: [8.8] }] },
      },
    ],
    error: null,
  },
};

const b3Body = {
  cashDividends: [
    {
      label: "RENDIMENTO",
      lastDatePrior: "30/10/2026",
      paymentDate: "16/11/2026",
      rate: "0,09500000000",
    },
    {
      label: "RENDIMENTO",
      lastDatePrior: "30/09/2026",
      paymentDate: "15/10/2026",
      rate: "0,10000000000",
    },
    {
      label: "AMORTIZACAO",
      lastDatePrior: "30/09/2026",
      paymentDate: "15/10/2026",
      rate: "0,50000000000",
    },
    {
      label: "RENDIMENTO",
      lastDatePrior: "31/08/2016",
      paymentDate: "15/09/2016",
      rate: "0,08000000000",
    },
    { label: "RENDIMENTO", lastDatePrior: "29/08/2026", paymentDate: null, rate: "0,10000000000" },
  ],
  stockDividends: [],
};

const fetchWith =
  (body: unknown, status = 200): typeof fetch =>
  async (url) => {
    const text = JSON.stringify(body);
    return new Response(text, {
      status,
      headers: { "content-type": "application/json", "x-url": String(url) },
    });
  };

const options = { today: "2026-11-09" };

describe("Yahoo Finance", () => {
  it("lê a cotação e a variação do dia, em texto, com o horário do pregão", async () => {
    const seen: string[] = [];
    const quote = await fetchYahooQuote("MXRF11", {
      ...options,
      fetch: async (url, init) => {
        seen.push(String(url), JSON.stringify(init?.headers));
        return fetchWith(yahooBody)(url, init);
      },
    });
    expect(quote).toEqual({
      ticker: "MXRF11",
      price: "8.80000000",
      changePercent: "0.5714",
      quotedAt: new Date(1793998980 * 1000),
    });
    expect(seen[0]).toContain("/MXRF11.SA?");
    // A rota pública exige identificação de navegador, e o token da brapi nunca vai para lá.
    expect(seen[1]).toContain("user-agent");
    expect(seen[1]).not.toContain("authorization");
  });

  it("ticker fora da B3 ou sem resultado é desconhecido; resposta estranha é formato", async () => {
    await expect(
      fetchYahooQuote("XXXX11", {
        ...options,
        fetch: fetchWith({ chart: { result: null, error: { code: "Not Found" } } }),
      }),
    ).rejects.toMatchObject({ code: "nao_encontrado" } satisfies Partial<MarketError>);
    await expect(
      fetchYahooQuote("MXRF11", { ...options, fetch: fetchWith({ nada: true }) }),
    ).rejects.toMatchObject({ code: "formato" });
  });
});

describe("B3, fundos listados", () => {
  it("monta o identificador do fundo pelo código de negociação", () => {
    expect(b3FundIdentifier("MXRF11")).toBe("MXRF");
    expect(b3FundIdentifier("HGLG11B")).toBe("HGLG");
  });

  it("converte datas e valores da B3, ignora amortização, sem pagamento e fora do histórico", async () => {
    const seen: string[] = [];
    // A B3 devolve o JSON dentro de uma string (resposta real de 2026-11-09); o objeto puro também vale.
    const rows = await fetchB3FiiDividends("MXRF11", {
      ...options,
      fetch: async (url, init) => {
        seen.push(String(url));
        return fetchWith(JSON.stringify(b3Body))(url, init);
      },
    });
    expect(await fetchB3FiiDividends("MXRF11", { ...options, fetch: fetchWith(b3Body) })).toEqual(
      rows,
    );
    expect(rows).toEqual([
      {
        ticker: "MXRF11",
        kind: "rendimento",
        comDate: "2026-09-30",
        exDate: null,
        payDate: "2026-10-15",
        ratePerShare: "0.10000000",
        seq: 1,
        source: "b3",
      },
      {
        ticker: "MXRF11",
        kind: "rendimento",
        comDate: "2026-10-30",
        exDate: null,
        payDate: "2026-11-16",
        ratePerShare: "0.09500000",
        seq: 1,
        source: "b3",
      },
    ]);
    const payload = JSON.parse(
      Buffer.from(seen[0]!.split("/GetListedSupplementFunds/")[1]!, "base64").toString(),
    );
    expect(payload).toEqual({ cnpj: "0", identifierFund: "MXRF", typeFund: 7 });
  });
});
