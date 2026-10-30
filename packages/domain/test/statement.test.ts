import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  csvRows,
  decodeStatement,
  detectCsvMapping,
  parseCsvTable,
  parseOfx,
  parsePdfLines,
  parseStatementAmount,
  parseStatementDate,
  reconcileRows,
  withFingerprints,
  type KnownEntry,
  type StatementRow,
} from "../src/statement";

const amount = (text: string) => parseStatementAmount(text)?.toFixed(2);

describe("valores do extrato", () => {
  it.each([
    ["1.234,56", "1234.56"],
    ["1,234.56", "1234.56"],
    ["1234.56", "1234.56"],
    ["1234,56", "1234.56"],
    ["1.234", "1234.00"],
    ["1.234.567,89", "1234567.89"],
    ["R$ 10,00", "10.00"],
    ["-R$ 10,00", "-10.00"],
    ["(10,00)", "-10.00"],
    ["10,00-", "-10.00"],
    ["10,00 D", "-10.00"],
    ["10,00 C", "10.00"],
  ])("lê %s", (input, expected) => {
    expect(amount(input)).toBe(expected);
  });

  it("recusa texto sem número", () => {
    expect(parseStatementAmount("")).toBeNull();
    expect(parseStatementAmount("Valor")).toBeNull();
  });
});

describe("datas do extrato", () => {
  it.each([
    ["31/10/2026", "2026-10-31"],
    ["31/10/26", "2026-10-31"],
    ["31-10-2026", "2026-10-31"],
    ["2026-10-31", "2026-10-31"],
    ["20261031", "2026-10-31"],
    ["20261031120000[-3:BRT]", "2026-10-31"],
  ])("lê %s", (input, expected) => {
    expect(parseStatementDate(input)).toBe(expected);
  });

  it("recusa data que não existe", () => {
    expect(parseStatementDate("31/02/2026")).toBeNull();
    expect(parseStatementDate("Total")).toBeNull();
  });
});

describe("arquivo", () => {
  it("usa Windows-1252 quando o arquivo não é UTF-8", () => {
    const bytes = Uint8Array.from([0x50, 0x41, 0x47, 0x54, 0xba, 0x20, 0xc7, 0xc3, 0x4f]);
    expect(decodeStatement(bytes)).toBe("PAGTº ÇÃO");
  });

  it("mantém UTF-8 e remove a marca inicial", () => {
    const bytes = new TextEncoder().encode("﻿Ação");
    expect(decodeStatement(bytes)).toBe("Ação");
  });
});

describe("OFX", () => {
  // Formato SGML do OFX 1.x, sem tags de fechamento, como exportam bancos brasileiros.
  const sgml = `OFXHEADER:100
DATA:OFXSGML
ENCODING:USASCII
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261005120000[-3:BRT]
<TRNAMT>-150.90
<FITID>A1
<MEMO>Compra &amp; pagamento
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261006
<TRNAMT>5000,00
<FITID>A2
<NAME>Salario
</STMTTRN>
<STMTTRN>
<DTPOSTED>sem-data
<TRNAMT>1.00
<FITID>A3
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it("lê OFX sem tags de fechamento", () => {
    const { rows, skipped } = parseOfx(sgml);
    expect(skipped).toBe(1);
    expect(rows).toEqual([
      {
        date: "2026-10-05",
        description: "Compra & pagamento",
        amount: "150.90",
        kind: "despesa",
        externalId: "A1",
      },
      {
        date: "2026-10-06",
        description: "Salario",
        amount: "5000.00",
        kind: "receita",
        externalId: "A2",
      },
    ]);
  });

  it("lê OFX 2 em XML", () => {
    const xml = `<?xml version="1.0"?><OFX><STMTTRN><DTPOSTED>20261005</DTPOSTED><TRNAMT>-10.00</TRNAMT><FITID>X</FITID><MEMO>Café</MEMO></STMTTRN></OFX>`;
    expect(parseOfx(xml).rows[0]).toMatchObject({ amount: "10.00", description: "Café" });
  });

  it("avisa quando não há lançamentos", () => {
    expect(() => parseOfx("não é ofx")).toThrow(RangeError);
  });
});

describe("CSV", () => {
  const parse = (text: string) => {
    const table = parseCsvTable(text);
    const mapping = detectCsvMapping(table);
    if (!mapping) throw new Error("sem colunas");
    return csvRows(table, mapping);
  };

  it("lê separado por ponto e vírgula, com título antes do cabeçalho e linha de saldo", () => {
    const { rows, skipped } = parse(
      [
        "Extrato de conta corrente",
        "Período: outubro",
        "Data;Histórico;Valor (R$);Saldo (R$)",
        '05/10/2026;"Compra; mercado";-1.234,56;2.000,00',
        "06/10/2026;Salário;5.000,00;7.000,00",
        "07/10/2026;Saldo do dia;;7.000,00",
      ].join("\n"),
    );
    expect(skipped).toBe(1);
    expect(rows).toEqual([
      { date: "2026-10-05", description: "Compra; mercado", amount: "1234.56", kind: "despesa" },
      { date: "2026-10-06", description: "Salário", amount: "5000.00", kind: "receita" },
    ]);
  });

  it("usa o identificador do banco quando existe", () => {
    const { rows } = parse(
      "Data,Valor,Identificador,Descrição\n05/10/2026,-10.50,abc-123,Padaria\n06/10/2026,20.00,abc-124,Pix recebido",
    );
    expect(rows[0]).toMatchObject({ amount: "10.50", kind: "despesa", externalId: "abc-123" });
    expect(rows[1]).toMatchObject({ kind: "receita", externalId: "abc-124" });
  });

  it("lê colunas separadas de crédito e débito", () => {
    const { rows } = parse(
      "Data;Descrição;Crédito;Débito\n05/10/2026;Salário;5.000,00;\n06/10/2026;Luz;;200,00",
    );
    expect(rows.map((r) => [r.kind, r.amount])).toEqual([
      ["receita", "5000.00"],
      ["despesa", "200.00"],
    ]);
  });

  it("deduz as colunas quando não há cabeçalho", () => {
    const { rows } = parse(
      "05/10/2026;Padaria;-10,00\n06/10/2026;Mercado;-20,00\n07/10/2026;Salário;100,00",
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ description: "Padaria", amount: "10.00" });
  });

  it("ignora linhas que não são lançamentos", () => {
    const { rows, skipped } = parse(
      "Data;Descrição;Valor\n05/10/2026;Padaria;-10,00\nTotal;;-10,00",
    );
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it("não quebra com conteúdo qualquer", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const table = parseCsvTable(text);
        const mapping = detectCsvMapping(table);
        if (mapping) csvRows(table, mapping);
      }),
    );
  });
});

const row = (over: Partial<StatementRow> = {}): StatementRow => ({
  date: "2026-10-05",
  description: "Aluguel",
  amount: "1500.00",
  kind: "despesa",
  ...over,
});

describe("identidade da linha", () => {
  it("é a mesma ao reimportar o arquivo", () => {
    const rows = [row(), row({ description: "Padaria", amount: "10.00" })];
    expect(withFingerprints(rows, "csv")).toEqual(withFingerprints([...rows], "csv"));
  });

  it("mantém duas compras iguais no mesmo dia", () => {
    const [first, second] = withFingerprints([row(), row()], "csv");
    expect(first!.fingerprint).not.toBe(second!.fingerprint);
  });

  it("prefere o identificador do banco", () => {
    const [first] = withFingerprints([row({ externalId: "A1" })], "ofx");
    expect(first!.fingerprint).toBe("ofx:id:A1#0");
  });
});

describe("conciliação", () => {
  const entry = (over: Partial<KnownEntry> = {}): KnownEntry => ({
    key: "p:1",
    description: "Aluguel",
    amount: "1500.00",
    date: "2026-10-05",
    kind: "despesa",
    ...over,
  });
  const empty = { realized: [], forecasts: [] };

  it("linha sem correspondência é nova", () => {
    const [result] = reconcileRows(withFingerprints([row()], "csv"), empty);
    expect(result).toMatchObject({ state: "novo", match: null });
  });

  it("marca o que já foi importado", () => {
    const rows = withFingerprints([row()], "csv");
    const [result] = reconcileRows(rows, {
      realized: [entry({ key: "t:1", fingerprint: rows[0]!.fingerprint })],
      forecasts: [],
    });
    expect(result!.state).toBe("importado");
  });

  it("dá baixa na previsão de mesmo valor até 5 dias", () => {
    const rows = withFingerprints([row({ date: "2026-10-08" })], "csv");
    const [near] = reconcileRows(rows, { realized: [], forecasts: [entry()] });
    expect(near).toMatchObject({ state: "previsto", match: { key: "p:1" } });
    const [far] = reconcileRows(rows, {
      realized: [],
      forecasts: [entry({ date: "2026-10-20" })],
    });
    expect(far!.state).toBe("novo");
  });

  it("uma previsão só atende uma linha", () => {
    const rows = withFingerprints([row(), row()], "csv");
    const result = reconcileRows(rows, { realized: [], forecasts: [entry()] });
    expect(result.map((r) => r.state)).toEqual(["previsto", "novo"]);
  });

  it("não concilia receita com despesa", () => {
    const rows = withFingerprints([row({ kind: "receita" })], "csv");
    const [result] = reconcileRows(rows, { realized: [], forecasts: [entry()] });
    expect(result!.state).toBe("novo");
  });

  it("avisa quando parece repetir um lançamento manual", () => {
    const rows = withFingerprints([row({ date: "2026-10-07" })], "csv");
    const [result] = reconcileRows(rows, { realized: [entry({ key: "t:9" })], forecasts: [] });
    expect(result).toMatchObject({ state: "lancado", match: { key: "t:9" } });
  });
});

describe("extrato em PDF", () => {
  it("lê data, descrição e valor, com ou sem saldo no fim", () => {
    const { rows, skipped } = parsePdfLines(
      [
        "Extrato de conta corrente",
        "15/10/2026 PADARIA EXEMPLO -12,34 1.000,00",
        "16/10/2026 PIX RECEBIDO MARIA 1.500,00 2.500,00",
        "17/10 LOJA EXEMPLO 45,90 D",
        "18/10/26 Compra sem sinal 20,00",
        "19/10/2026 SALDO DO DIA 2.000,00",
        "Página 1 de 2",
      ],
      2026,
    );
    expect(rows).toEqual([
      { date: "2026-10-15", description: "PADARIA EXEMPLO", amount: "12.34", kind: "despesa" },
      { date: "2026-10-16", description: "PIX RECEBIDO MARIA", amount: "1500.00", kind: "receita" },
      { date: "2026-10-17", description: "LOJA EXEMPLO", amount: "45.90", kind: "despesa" },
      { date: "2026-10-18", description: "Compra sem sinal", amount: "20.00", kind: "despesa" },
    ]);
    expect(skipped).toBe(1);
  });

  it("não acha nada em texto sem lançamentos", () => {
    expect(parsePdfLines(["Bem-vindo ao seu banco"], 2026).rows).toEqual([]);
  });
});
