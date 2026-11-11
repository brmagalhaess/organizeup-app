import { describe, expect, it } from "vitest";
import {
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

  it("sugere o preço médio só quando todo o valor aplicado é conhecido", () => {
    expect(portfolio.paid).toEqual({ "1": "32" });
  });

  it("lista o que não tem código de bolsa, com o motivo", () => {
    expect(portfolio.file.ignored).toEqual([
      { line: 3, label: "CDB Banco X 110% CDI", date: null, reason: "ativo_nao_listado" },
    ]);
  });
});
