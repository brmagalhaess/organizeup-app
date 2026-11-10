// Fontes gratuitas de mercado (ADR-0032), com respostas gravadas em 2026-11-09.
import { describe, expect, it } from "vitest";
import {
  b3FundIdentifier,
  b3TickerOfIsin,
  fetchB3CompanyEvents,
  fetchB3FiiDividends,
  fetchB3Issuers,
  fetchYahooQuote,
  MarketError,
} from "../src/market";

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
    // A rota pública exige identificação de navegador, e nenhuma chave vai para lá.
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

describe("B3, empresas listadas (ADR-0035)", () => {
  it("acha o código de negociação pelo ISIN", () => {
    expect(b3TickerOfIsin("BRPETRACNOR9")).toBe("PETR3");
    expect(b3TickerOfIsin("BRPETRACNPR6")).toBe("PETR4");
    expect(b3TickerOfIsin("BRTAEECDAM10")).toBe("TAEE11");
    // Série antiga da mesma classe cai no mesmo código.
    expect(b3TickerOfIsin("BRBBASA04OR8")).toBe("BBAS3");
    expect(b3TickerOfIsin("BRPETRDBS092")).toBeNull();
    expect(b3TickerOfIsin("US0378331005")).toBeNull();
  });

  it("traz proventos e eventos só da classe pedida, no valor pago, sem repetir séries", async () => {
    // Resposta real da PETR em 2026-11-09, reduzida: ON e PN com os mesmos pagamentos.
    const petr = [
      {
        code: "PETR",
        cashDividends: [
          {
            assetIssued: "BRPETRACNOR9",
            paymentDate: "21/12/2026",
            rate: "0,47156696000",
            label: "DIVIDENDO",
            lastDatePrior: "21/08/2026",
          },
          {
            assetIssued: "BRPETRACNPR6",
            paymentDate: "21/12/2026",
            rate: "0,47156696000",
            label: "DIVIDENDO",
            lastDatePrior: "21/08/2026",
          },
          {
            assetIssued: "BRPETRACNPR6",
            paymentDate: "23/11/2026",
            rate: "0,67407131000",
            label: "JRS CAP PROPRIO",
            lastDatePrior: "21/08/2026",
          },
          // Mesma linha em série antiga da PN: entra uma vez.
          {
            assetIssued: "BRPETRA01PR2",
            paymentDate: "23/11/2026",
            rate: "0,67407131000",
            label: "JRS CAP PROPRIO",
            lastDatePrior: "21/08/2026",
          },
          // Dois JCP iguais nas datas, valores diferentes: ganham seq.
          {
            assetIssued: "BRPETRACNPR6",
            paymentDate: "23/11/2026",
            rate: "0,20250435000",
            label: "JRS CAP PROPRIO",
            lastDatePrior: "21/08/2026",
          },
          {
            assetIssued: "BRPETRACNPR6",
            paymentDate: null,
            rate: "1,0",
            label: "DIVIDENDO",
            lastDatePrior: "01/06/2026",
          },
          {
            assetIssued: "BRPETRACNPR6",
            paymentDate: "20/08/2016",
            rate: "1,0",
            label: "DIVIDENDO",
            lastDatePrior: "01/06/2016",
          },
        ],
        stockDividends: [
          {
            assetIssued: "BRPETRACNPR6",
            factor: "100,00000000000",
            label: "DESDOBRAMENTO",
            lastDatePrior: "25/04/2008",
          },
          {
            assetIssued: "BRPETRACNOR9",
            factor: "100,00000000000",
            label: "DESDOBRAMENTO",
            lastDatePrior: "25/04/2008",
          },
        ],
      },
    ];
    const seen: string[] = [];
    const result = await fetchB3CompanyEvents("PETR4", {
      ...options,
      fetch: async (url, init) => {
        seen.push(String(url));
        return fetchWith(petr)(url, init);
      },
    });
    const payload = JSON.parse(
      Buffer.from(seen[0]!.split("/GetListedSupplementCompany/")[1]!, "base64").toString(),
    );
    expect(payload).toEqual({ issuingCompany: "PETR", language: "pt-br" });
    expect(result.dividends).toEqual([
      {
        ticker: "PETR4",
        kind: "jcp",
        comDate: "2026-08-21",
        exDate: null,
        payDate: "2026-11-23",
        ratePerShare: "0.67407131",
        seq: 1,
        source: "b3",
      },
      {
        ticker: "PETR4",
        kind: "dividendo",
        comDate: "2026-08-21",
        exDate: null,
        payDate: "2026-12-21",
        ratePerShare: "0.47156696",
        seq: 1,
        source: "b3",
      },
      {
        ticker: "PETR4",
        kind: "jcp",
        comDate: "2026-08-21",
        exDate: null,
        payDate: "2026-11-23",
        ratePerShare: "0.20250435",
        seq: 2,
        source: "b3",
      },
    ]);
    expect(result.stockEvents).toEqual([
      { comDate: "2008-04-25", factor: "2.00000000", note: "Desdobramento de 2 para 1" },
    ]);
    // O JSON dentro de uma string também vale.
    expect(
      await fetchB3CompanyEvents("PETR4", { ...options, fetch: fetchWith(JSON.stringify(petr)) }),
    ).toEqual(result);
    await expect(
      fetchB3CompanyEvents("PETR4", { ...options, fetch: fetchWith([]) }),
    ).rejects.toMatchObject({ code: "nao_encontrado" });
  });
});

describe("B3, emissoras listadas (ADR-0036)", () => {
  // Linhas reais da lista de empresas em 2026-11-10: ação, BDR e registros sem negociação.
  const page = (pageNumber: number, results: unknown[]) => ({
    page: { pageNumber, pageSize: 120, totalRecords: 3, totalPages: 2 },
    results,
  });
  const first = page(1, [
    {
      codeCVM: "9512",
      issuingCompany: "PETR",
      companyName: "PETROLEO BRASILEIRO S.A. PETROBRAS",
      tradingName: "PETROBRAS",
      type: "1",
      market: "N2",
      typeBDR: "",
      status: "A",
    },
    {
      codeCVM: "50110",
      issuingCompany: "CBTC",
      companyName: "21SHARES BITCOIN CORE ETP",
      tradingName: "21SH BITCOIN",
      type: "4",
      market: "DRE",
      typeBDR: "DRE",
      status: "A",
    },
    // Registro sem negociação (debênture, fundo fechado): fora.
    {
      codeCVM: "900049",
      issuingCompany: "UQMU",
      companyName: "1461 INVESTIMENTOS S.A",
      tradingName: "1461 INVEST",
      type: "7",
      market: "",
      typeBDR: "",
      status: "A",
    },
  ]);
  const second = page(2, [
    {
      codeCVM: "23795",
      issuingCompany: "CXSE",
      companyName: "CAIXA SEGURIDADE PARTICIPACOES S.A.",
      tradingName: "CAIXA SEGURI",
      type: "1",
      market: "NM",
      typeBDR: "",
      status: "A",
    },
  ]);

  it("lê as páginas até o fim e guarda só ações e BDRs ativos, com nome de pregão e raiz", async () => {
    const seen: number[] = [];
    const result = await fetchB3Issuers({
      ...options,
      fetch: async (url, init) => {
        const payload = JSON.parse(
          Buffer.from(String(url).split("/GetInitialCompanies/")[1]!, "base64").toString(),
        ) as { pageNumber: number; pageSize: number; language: string };
        seen.push(payload.pageNumber);
        expect(payload).toMatchObject({ pageSize: 120, language: "pt-br" });
        return fetchWith(payload.pageNumber === 1 ? first : second)(url, init);
      },
    });
    expect(seen).toEqual([1, 2]);
    expect(result.pages).toBe(2);
    expect(result.rows).toEqual([
      {
        issuer: "PETR",
        tradingName: "PETROBRAS",
        companyName: "PETROLEO BRASILEIRO S.A. PETROBRAS",
        kind: "acao",
        segment: "N2",
        codeCvm: "9512",
        source: "b3",
      },
      {
        issuer: "CBTC",
        tradingName: "21SH BITCOIN",
        companyName: "21SHARES BITCOIN CORE ETP",
        kind: "bdr",
        segment: "DRE",
        codeCvm: "50110",
        source: "b3",
      },
      {
        issuer: "CXSE",
        tradingName: "CAIXA SEGURI",
        companyName: "CAIXA SEGURIDADE PARTICIPACOES S.A.",
        kind: "acao",
        segment: "NM",
        codeCvm: "23795",
        source: "b3",
      },
    ]);
    await expect(
      fetchB3Issuers({ ...options, fetch: fetchWith({ nada: true }) }),
    ).rejects.toMatchObject({ code: "formato" });
  });
});
