import { describe, expect, it } from "vitest";
import {
  feedAssetClass,
  feedCardPurchasesOf,
  feedDateOf,
  feedPortfolioOf,
  feedStatementOf,
  feedWindowStart,
  parseFeedItemIds,
  withFingerprints,
} from "../src";

const TZ = "America/Sao_Paulo";
const ID_A = "0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a41";
const ID_B = "1b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a42";

describe("identificadores de conexão", () => {
  it("aceita um por linha ou separados por vírgula, sem repetir", () => {
    expect(parseFeedItemIds(`${ID_A}\n ${ID_B.toUpperCase()}, ${ID_A}`)).toEqual([ID_A, ID_B]);
  });

  it("recusa vazio, texto que não é identificador e mais de cinco", () => {
    expect(parseFeedItemIds("  ")).toBeNull();
    expect(parseFeedItemIds(`${ID_A}, minha-conta`)).toBeNull();
    const six = Array.from({ length: 6 }, (_, i) => ID_A.replace(/.$/, String(i)));
    expect(parseFeedItemIds(six.join(","))).toBeNull();
  });
});

describe("janela da busca", () => {
  it("começa 90 dias atrás na primeira vez", () => {
    expect(feedWindowStart("2026-11-11", null)).toBe("2026-08-13");
  });

  it("depois refaz a última semana já trazida", () => {
    expect(feedWindowStart("2026-11-11", "2026-11-05")).toBe("2026-10-29");
  });

  it("respeita a data pedida, sem passar de um ano nem do dia de hoje", () => {
    expect(feedWindowStart("2026-11-11", "2026-11-05", "2026-01-01")).toBe("2026-01-01");
    expect(feedWindowStart("2026-11-11", null, "2020-01-01")).toBe("2025-11-11");
    expect(feedWindowStart("2026-11-11", null, "2027-01-01")).toBe("2026-11-11");
  });
});

describe("dia do lançamento", () => {
  it("meia-noite em UTC é data sem hora: vale o próprio dia", () => {
    expect(feedDateOf("2026-11-03T00:00:00.000Z", TZ)).toBe("2026-11-03");
    expect(feedDateOf("2026-11-03", TZ)).toBe("2026-11-03");
  });

  it("com hora, vale o dia no fuso da família", () => {
    expect(feedDateOf("2026-11-04T01:30:00.000Z", TZ)).toBe("2026-11-03");
    expect(feedDateOf("2026-11-03T03:00:00.000Z", TZ)).toBe("2026-11-03");
  });

  it("recusa o que não é data", () => {
    expect(feedDateOf("ontem", TZ)).toBeNull();
    expect(feedDateOf(null, TZ)).toBeNull();
    expect(feedDateOf("2026-13-40T00:00:00.000Z", TZ)).toBeNull();
  });
});

describe("extrato vindo da conexão", () => {
  const statement = feedStatementOf(
    [
      {
        id: "t3",
        date: "2026-11-05T12:00:00.000Z",
        description: "PIX RECEBIDO",
        type: "CREDIT",
        amount: 1500,
      },
      {
        id: "t1",
        date: "2026-11-03T00:00:00.000Z",
        description: "  MERCADO  CENTRAL ",
        type: "DEBIT",
        amount: -84.9,
        status: "POSTED",
      },
      {
        id: "t2",
        date: "2026-11-04T00:00:00.000Z",
        description: "PADARIA",
        type: "DEBIT",
        amount: -12.5,
        status: "PENDING",
      },
      { id: "t4", date: "sem data", description: "X", type: "DEBIT", amount: -1 },
      { id: "t5", date: "2026-11-06T00:00:00.000Z", description: "ZERO", type: "DEBIT", amount: 0 },
      {
        id: "t6",
        date: "2026-11-06T00:00:00.000Z",
        description: null,
        descriptionRaw: "=SOMA(A1)",
        amount: -3.335,
      },
    ],
    TZ,
  );

  it("traz valor positivo, sentido pelo tipo e ordem por data", () => {
    expect(statement.rows).toEqual([
      {
        date: "2026-11-03",
        description: "MERCADO CENTRAL",
        amount: "84.90",
        kind: "despesa",
        externalId: "pluggy:t1",
      },
      {
        date: "2026-11-05",
        description: "PIX RECEBIDO",
        amount: "1500.00",
        kind: "receita",
        externalId: "pluggy:t3",
      },
      {
        date: "2026-11-06",
        description: "—",
        amount: "3.34",
        kind: "despesa",
        externalId: "pluggy:t6",
      },
    ]);
  });

  it("deixa pendente para depois e conta o que não deu para ler", () => {
    expect(statement.pending).toBe(1);
    expect(statement.skipped).toBe(2);
    expect(statement.truncated).toBe(false);
  });

  it("a mesma linha buscada duas vezes tem a mesma impressão digital", () => {
    const again = feedStatementOf(
      [
        {
          id: "t1",
          date: "2026-11-03T00:00:00.000Z",
          description: "OUTRO TEXTO",
          type: "DEBIT",
          amount: -84.9,
        },
      ],
      TZ,
    );
    const first = withFingerprints(statement.rows, "ofx")[0]!.fingerprint;
    expect(withFingerprints(again.rows, "ofx")[0]!.fingerprint).toBe(first);
    expect(first).toBe("ofx:id:pluggy:t1#0");
  });

  it("acima do teto ficam as linhas mais recentes", () => {
    const many = Array.from({ length: 2005 }, (_, i) => ({
      id: `m${i}`,
      date: i < 5 ? "2026-01-01T00:00:00.000Z" : "2026-02-01T00:00:00.000Z",
      description: "LINHA",
      type: "DEBIT",
      amount: -1,
    }));
    const big = feedStatementOf(many, TZ);
    expect(big.truncated).toBe(true);
    expect(big.rows).toHaveLength(2000);
    expect(big.rows[0]!.date).toBe("2026-02-01");
  });
});

describe("posição vinda da conexão", () => {
  const portfolio = feedPortfolioOf([
    {
      id: "i1",
      code: "PETR4",
      name: "PETROBRAS PN",
      type: "EQUITY",
      quantity: 100,
      value: 38.5,
      amount: 3850,
      amountOriginal: 3000,
    },
    {
      id: "i2",
      code: "petr4f",
      name: "PETROBRAS PN",
      type: "EQUITY",
      quantity: 50,
      value: 38.5,
      amountOriginal: 1800,
    },
    { id: "i3", code: "BTHF11", name: "BTG FOF", type: "EQUITY", quantity: 10, amount: 95 },
    {
      id: "i4",
      code: null,
      name: "CDB Banco X 110% CDI",
      type: "FIXED_INCOME",
      quantity: 1,
      amount: 5000,
    },
    {
      id: "i5",
      code: "VALE3",
      name: "VALE ON",
      type: "EQUITY",
      quantity: 20,
      value: 60,
      status: "TOTAL_WITHDRAWAL",
    },
    { id: "i6", code: "ITSA4", name: "ITAUSA PN", type: "EQUITY", quantity: 0, value: 10 },
    { id: "i7", code: null, name: "Fundo zerado", type: "MUTUAL_FUND", quantity: 0, amount: 0 },
  ]);

  it("soma o mesmo código e ignora o que foi zerado", () => {
    expect(portfolio.file.kind).toBe("posicao");
    expect(portfolio.file.trades).toEqual([]);
    expect(portfolio.file.positions).toEqual([
      { line: 0, ticker: "BTHF11", name: "BTG FOF", quantity: "10", closePrice: "9.5" },
      { line: 1, ticker: "PETR4", name: "PETROBRAS PN", quantity: "150", closePrice: "38.5" },
    ]);
  });

  it("preenche com o preço médio pago, ou com o de mercado quando não sabe o que foi aplicado", () => {
    expect(portfolio.paid).toEqual({ "0": "9.5", "1": "32" });
    expect(portfolio.estimated).toEqual(["0"]);
  });

  it("leva o tipo do ativo quando a instituição informa", () => {
    expect(feedAssetClass("EQUITY", "STOCK")).toBe("acao");
    expect(feedAssetClass("EQUITY", "REAL_ESTATE_FUND")).toBe("fii");
    expect(feedAssetClass("ETF", "ETF")).toBe("etf_bdr");
    expect(feedAssetClass("EQUITY", "BDR")).toBe("etf_bdr");
    expect(feedAssetClass("MUTUAL_FUND", "INVESTMENT_FUND")).toBeNull();
    const typed = feedPortfolioOf([
      { id: "a", code: "ABEV3", type: "EQUITY", subtype: "STOCK", quantity: 100, value: 15.61 },
      {
        id: "b",
        code: "TRXF11",
        type: "EQUITY",
        subtype: "REAL_ESTATE_FUND",
        quantity: 1,
        value: 115,
      },
      { id: "c", code: "IVVB11", type: "ETF", subtype: "ETF", quantity: 2, value: 300 },
    ]);
    expect(typed.classes).toEqual({ ABEV3: "acao", IVVB11: "etf_bdr", TRXF11: "fii" });
  });

  it("lista o que não tem código de bolsa, com o motivo", () => {
    expect(portfolio.file.ignored).toEqual([
      { line: 3, label: "CDB Banco X 110% CDI", date: null, reason: "ativo_nao_listado" },
    ]);
  });
});

describe("compras do cartão vindas da conexão", () => {
  const card = feedCardPurchasesOf(
    [
      {
        id: "c1",
        date: "2026-10-31T14:35:00.000Z",
        description: "MERCADO BOM",
        type: "DEBIT",
        amount: 120.5,
        status: "POSTED",
        installmentNumber: 1,
        totalInstallments: 1,
      },
      {
        id: "c2",
        date: "2026-10-30T03:00:00.000Z",
        description: "LOJA DE MOVEIS",
        type: "DEBIT",
        amount: 100,
        status: "POSTED",
        installmentNumber: 4,
        totalInstallments: 12,
        purchaseDate: "2026-07-29T03:00:00.000Z",
      },
      {
        id: "c3",
        date: "2026-09-30T03:00:00.000Z",
        description: "LOJA DE MOVEIS",
        type: "DEBIT",
        amount: 100,
        status: "POSTED",
        installmentNumber: 3,
        totalInstallments: 12,
        purchaseDate: "2026-07-29T03:00:00.000Z",
      },
      {
        id: "c4",
        date: "2026-10-20T03:00:00.000Z",
        description: "PAGAMENTO DE FATURA",
        type: "CREDIT",
        amount: -3000,
        status: "POSTED",
      },
      {
        id: "c5",
        date: "2026-11-02T03:00:00.000Z",
        description: "POSTO",
        type: "DEBIT",
        amount: 200,
        status: "PENDING",
      },
      {
        id: "c6",
        date: "2026-10-10T03:00:00.000Z",
        description: "ULTIMA PARCELA",
        type: "DEBIT",
        amount: 50,
        status: "POSTED",
        installmentNumber: 5,
        totalInstallments: 5,
        purchaseDate: "2026-06-09T03:00:00.000Z",
      },
      { id: "c7", date: "sem data", description: "X", type: "DEBIT", amount: 1 },
    ],
    TZ,
  );

  it("à vista vira uma compra, com o identificador da linha", () => {
    expect(card.rows.find((row) => row.description === "MERCADO BOM")).toEqual({
      date: "2026-10-31",
      description: "MERCADO BOM",
      amount: "120.50",
      kind: "despesa",
      installments: 1,
      externalId: "pluggy:c1",
    });
  });

  it("parcelada vira uma compra só, da parcela mais antiga, com o que falta", () => {
    const plan = card.rows.filter((row) => row.description.startsWith("LOJA DE MOVEIS"));
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      date: "2026-09-30",
      description: "LOJA DE MOVEIS (desde 3/12)",
      amount: "1000.00",
      installments: 10,
    });
  });

  it("a parcela do mês seguinte tem o mesmo identificador e não entra de novo", () => {
    const next = feedCardPurchasesOf(
      [
        {
          id: "c9",
          date: "2026-11-30T03:00:00.000Z",
          description: "LOJA DE MOVEIS",
          type: "DEBIT",
          amount: 100,
          status: "POSTED",
          installmentNumber: 5,
          totalInstallments: 12,
          purchaseDate: "2026-07-29T03:00:00.000Z",
        },
      ],
      TZ,
    );
    const first = card.rows.find((row) => row.description.startsWith("LOJA DE MOVEIS"))!;
    expect(next.rows[0]!.externalId).toBe(first.externalId);
    expect(withFingerprints(next.rows, "ofx")[0]!.fingerprint).toBe(
      withFingerprints([first], "ofx")[0]!.fingerprint,
    );
  });

  it("a última parcela entra como uma parcela só", () => {
    expect(card.rows.find((row) => row.description.startsWith("ULTIMA"))).toMatchObject({
      description: "ULTIMA PARCELA (desde 5/5)",
      amount: "50.00",
      installments: 1,
    });
  });

  it("pagamento, estorno e pendente ficam de fora, contados", () => {
    expect(card.credits).toBe(1);
    expect(card.pending).toBe(1);
    expect(card.skipped).toBe(1);
    expect(card.rows).toHaveLength(3);
    expect(card.rows.map((row) => row.date)).toEqual(["2026-09-30", "2026-10-10", "2026-10-31"]);
  });
});
