// Importar a carteira (ADR-0024). Todo dado aqui é inventado: não há arquivo real no repositório, e o
// layout segue as fontes citadas em `b3-spreadsheet.ts` e `brokerage-note.ts`.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkInvestmentFile,
  cleanFileText,
  dateOf,
  decimalOf,
  guessAssetClass,
  InvestmentFileError,
  money,
  newAssetsOf,
  parseB3Workbook,
  parseBrokerageNotes,
  planInvestmentImport,
  planPositions,
  positionOf,
  selectedByDefault,
  shareFees,
  tickerOfIssuer,
  tickerOfTitle,
  tradeDateOfSettlement,
  withResolvedTickers,
  type CatalogAsset,
  type KnownHolding,
  type KnownTrade,
  type ParsedTrade,
  type PlannedTrade,
} from "../src";

const NEG_HEADER = [
  "Data do Negócio",
  "Tipo de Movimentação",
  "Mercado",
  "Prazo/Vencimento",
  "Instituição",
  "Código de Negociação",
  "Quantidade",
  "Preço",
  "Valor",
];
const MOV_HEADER = [
  "Entrada/Saída",
  "Data",
  "Movimentação",
  "Produto",
  "Instituição",
  "Quantidade",
  "Preço unitário",
  "Valor da Operação",
];
const POS_HEADER = [
  "Produto",
  "Instituição",
  "Conta",
  "Código de Negociação",
  "Quantidade",
  "Quantidade Disponível",
  "Preço de Fechamento",
  "Valor Atualizado",
];
const VISTA = "Mercado à Vista";
const BROKER = "CORRETORA EXEMPLO S.A.";

const neg = (rows: unknown[][]) =>
  parseB3Workbook([{ name: "Negociação", rows: [NEG_HEADER, ...rows] as never }]);
const mov = (rows: unknown[][]) =>
  parseB3Workbook([{ name: "Movimentação", rows: [MOV_HEADER, ...rows] as never }]);

const negRow = (
  date: unknown,
  side: string,
  ticker: string,
  quantity: unknown,
  price: unknown,
  value: unknown,
  market = VISTA,
) => [date, side, market, "-", BROKER, ticker, quantity, price, value];

const failure = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof InvestmentFileError) return error.code;
    throw error;
  }
  return null;
};

describe("células", () => {
  it("lê número em pt-BR, com moeda, float do Excel e notação científica", () => {
    expect(decimalOf("1.234,56")!.toFixed()).toBe("1234.56");
    expect(decimalOf("R$ 26,09")!.toFixed()).toBe("26.09");
    expect(decimalOf("R$ 26.09")!.toFixed()).toBe("26.09");
    expect(
      decimalOf(0.1 + 0.2)!
        .toDecimalPlaces(8)
        .toFixed(),
    ).toBe("0.3");
    expect(decimalOf("1E-3")!.toFixed()).toBe("0.001");
  });

  it("não adivinha: traço, texto e fórmula não são número", () => {
    expect(decimalOf("-")).toBeNull();
    expect(decimalOf("12 ações")).toBeNull();
    expect(decimalOf("=1+1")).toBeNull();
    expect(decimalOf(null)).toBeNull();
    expect(decimalOf(true)).toBeNull();
  });

  it("lê data em texto, Date do Excel e número de série", () => {
    expect(dateOf("05/03/2026")).toBe("2026-03-05");
    expect(dateOf(new Date(Date.UTC(2026, 2, 5)))).toBe("2026-03-05");
    expect(dateOf(46086)).toBe("2026-03-05");
    expect(dateOf("31/02/2026")).toBeNull();
    expect(dateOf("ontem")).toBeNull();
  });

  it("descarta texto com cara de fórmula", () => {
    expect(cleanFileText('=HYPERLINK("http://exemplo.test")')).toBe("");
    expect(cleanFileText("@SUM(A1)")).toBe("");
    expect(cleanFileText("  ABCD  SA\n")).toBe("ABCD SA");
  });
});

describe("conferência do arquivo", () => {
  const zip = (uncompressed: number) => {
    // Diretório central mínimo com os nomes de um xlsx.
    const names = ["[Content_Types].xml", "xl/workbook.xml"];
    const encoder = new TextEncoder();
    const entries = names.map((name) => {
      const bytes = encoder.encode(name);
      const entry = new Uint8Array(46 + bytes.length);
      const view = new DataView(entry.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint32(24, uncompressed, true);
      view.setUint16(28, bytes.length, true);
      entry.set(bytes, 46);
      return entry;
    });
    const size = entries.reduce((acc, entry) => acc + entry.length, 0);
    const out = new Uint8Array(4 + size + 22);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x04034b50, true);
    let at = 4;
    for (const entry of entries) {
      out.set(entry, at);
      at += entry.length;
    }
    view.setUint32(at, 0x06054b50, true);
    view.setUint16(at + 10, entries.length, true);
    view.setUint32(at + 16, 4, true);
    return out;
  };

  it("aceita xlsx e PDF de verdade", () => {
    expect(checkInvestmentFile(zip(1000), "negociacao.xlsx")).toBe("xlsx");
    expect(checkInvestmentFile(new TextEncoder().encode("%PDF-1.7 x"), "nota.pdf")).toBe("pdf");
  });

  it("recusa o que não é: extensão trocada, .xls, vazio, grande e zip bomb", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 x");
    expect(failure(() => checkInvestmentFile(pdf, "negociacao.xlsx"))).toBe("tipo");
    expect(failure(() => checkInvestmentFile(zip(10), "nota.pdf"))).toBe("tipo");
    expect(failure(() => checkInvestmentFile(pdf, "arquivo.xls"))).toBe("xls_antigo");
    expect(failure(() => checkInvestmentFile(new Uint8Array(), "nota.pdf"))).toBe("vazio");
    expect(failure(() => checkInvestmentFile(new Uint8Array(6 * 1024 * 1024), "nota.pdf"))).toBe(
      "tamanho",
    );
    // Declara 300 MB descomprimidos por entrada.
    expect(failure(() => checkInvestmentFile(zip(300 * 1024 * 1024), "bomba.xlsx"))).toBe("tipo");
  });
});

describe("Negociação", () => {
  it("lê compra e venda, tira o F do fracionário e guarda só o que importa", () => {
    const parsed = neg([
      negRow("05/03/2026", "Compra", "ABCD3", 100, 10.5, 1050),
      negRow("06/03/2026", "Compra", "ABCD3F", 5, "10,60", "53,00", "Mercado Fracionário"),
      negRow(new Date(Date.UTC(2026, 2, 9)), "Venda", "WXYZ11", "2", "R$ 100,00", "R$ 200,00"),
    ]);
    expect(parsed.kind).toBe("negociacao");
    expect(parsed.trades).toHaveLength(3);
    expect(parsed.trades[0]).toMatchObject({
      ticker: "ABCD3",
      side: "compra",
      date: "2026-03-05",
      quantity: "100",
      unitPrice: "10.5",
      fees: "0.00",
    });
    expect(parsed.trades[1]).toMatchObject({ ticker: "ABCD3", quantity: "5", unitPrice: "10.6" });
    expect(parsed.trades[2]).toMatchObject({ ticker: "WXYZ11", side: "venda", date: "2026-03-09" });
  });

  it("tolera coluna fora de ordem, sem acento, com título antes e caixa diferente", () => {
    const parsed = parseB3Workbook([
      {
        name: "Planilha1",
        rows: [
          ["Extrato de negociação de ativos"],
          [],
          [
            "VALOR",
            "preco",
            "quantidade",
            "codigo de negociacao",
            "TIPO DE MOVIMENTACAO",
            "DATA DO NEGOCIO",
          ],
          ["1.000,00", "10,00", "100", "ABCD4", "COMPRA", "2026-03-05"],
          ["Total", null, null, null, null, null],
        ],
      },
    ]);
    expect(parsed.trades).toHaveLength(1);
    expect(parsed.trades[0]).toMatchObject({ ticker: "ABCD4", unitPrice: "10", quantity: "100" });
    expect(parsed.ignored).toHaveLength(0);
  });

  it("ignora com motivo o que não é ação à vista e o que não fecha", () => {
    const parsed = neg([
      negRow("05/03/2026", "Compra", "ABCDE300", 100, 1, 100, "Opção de Compra"),
      negRow("05/03/2026", "Compra", "CDB123", 1, 1000, 1000),
      negRow("05/03/2026", "Compra", "ABCD3", 100, 10, 2000),
      negRow("05/03/2026", "Compra", "ABCD3", "=1+1", 10, 1000),
      negRow("99/99/2026", "Compra", "ABCD3", 100, 10, 1000),
      negRow("05/03/2026", "Doação", "ABCD3", 100, 10, 1000),
      negRow("05/03/2026", "Compra", '=cmd|"/C calc"!A0', 100, 10, 1000),
    ]);
    expect(parsed.trades).toHaveLength(0);
    expect(parsed.ignored.map((row) => row.reason)).toEqual([
      "mercado_nao_suportado",
      "ativo_nao_listado",
      "valores_nao_fecham",
      "dados_invalidos",
      "dados_invalidos",
      "outra_movimentacao",
      "ativo_nao_listado",
    ]);
    expect(JSON.stringify(parsed)).not.toContain("cmd");
  });

  it("recusa layout desconhecido com o código certo, nunca uma importação errada", () => {
    const sheet = (rows: unknown[][]) => [{ name: "A", rows: rows as never }];
    expect(
      failure(() =>
        parseB3Workbook(
          sheet([
            ["Nome", "Telefone"],
            ["Ana", "1"],
          ]),
        ),
      ),
    ).toBe("layout");
    expect(failure(() => parseB3Workbook([]))).toBe("layout");
    // Código e quantidade sozinhos não fazem uma Posição.
    expect(
      failure(() =>
        parseB3Workbook(
          sheet([
            ["Código de Negociação", "Quantidade"],
            ["ABCD3", 1],
          ]),
        ),
      ),
    ).toBe("layout");
    expect(failure(() => neg([]))).toBe("sem_linhas");
    expect(
      failure(() =>
        neg(Array.from({ length: 2001 }, () => negRow("05/03/2026", "Compra", "ABCD3", 1, 1, 1))),
      ),
    ).toBe("muitas_linhas");
  });
});

describe("Movimentação", () => {
  it("só Transferência - Liquidação vira operação, na data do negócio", () => {
    const parsed = mov([
      [
        "Credito",
        "09/03/2026",
        "Transferência - Liquidação",
        "ABCD3 - ABCD SA",
        BROKER,
        100,
        10.5,
        1050,
      ],
      [
        "Debito",
        "10/03/2026",
        "Transferência - Liquidação",
        "ABCD3F - ABCD SA",
        BROKER,
        5,
        "10,60",
        "53,00",
      ],
    ]);
    expect(parsed.kind).toBe("movimentacao");
    expect(parsed.trades.map((t) => [t.side, t.ticker, t.date])).toEqual([
      ["compra", "ABCD3", "2026-03-05"],
      ["venda", "ABCD3", "2026-03-06"],
    ]);
  });

  it("volta dois dias úteis, pulando o fim de semana", () => {
    expect(tradeDateOfSettlement("2026-03-05")).toBe("2026-03-03");
    expect(tradeDateOfSettlement("2026-03-09")).toBe("2026-03-05");
    expect(tradeDateOfSettlement("2026-03-10")).toBe("2026-03-06");
  });

  it("deixa de fora, com aviso, proventos, eventos e troca de corretora", () => {
    const row = (type: string, flow = "Credito") => [
      flow,
      "09/03/2026",
      type,
      "ABCD3 - ABCD SA",
      BROKER,
      100,
      "-",
      "-",
    ];
    const parsed = mov([
      row("Rendimento"),
      row("Dividendo"),
      row("Juros Sobre Capital Próprio"),
      row("Desdobro"),
      row("Grupamento"),
      row("Bonificação em Ativos"),
      row("Amortização"),
      row("Atualização"),
      row("Leilão de Fração"),
      row("Transferência"),
      row("Empréstimo"),
    ]);
    expect(parsed.trades).toHaveLength(0);
    expect(parsed.ignored.map((line) => line.reason)).toEqual([
      "provento",
      "provento",
      "provento",
      "evento",
      "evento",
      "evento",
      "evento",
      "evento",
      "evento",
      "transferencia",
      "outra_movimentacao",
    ]);
  });

  it("não aceita renda fixa como ação", () => {
    const parsed = mov([
      [
        "Credito",
        "09/03/2026",
        "Transferência - Liquidação",
        "CDB - BANCO EXEMPLO",
        BROKER,
        1,
        1000,
        1000,
      ],
    ]);
    expect(parsed.ignored[0]).toMatchObject({ reason: "ativo_nao_listado" });
  });
});

describe("Posição", () => {
  const sheet = (name: string, rows: unknown[][]) => ({ name, rows: rows as never });

  it("soma a mesma ação em duas corretoras, lê todas as abas e aponta o que não é bolsa", () => {
    const parsed = parseB3Workbook([
      sheet("Acoes", [
        POS_HEADER,
        ["ABCD3 - ABCD SA", BROKER, "1", "ABCD3", 100, 100, 12, 1200],
        ["ABCD3 - ABCD SA", "OUTRA CORRETORA", "2", "ABCD3", "50", "50", "12,00", "600,00"],
        ["Total", null, null, null, null, null, null, 1800],
      ]),
      sheet("Fundos", [POS_HEADER, ["WXYZ11 - FUNDO", BROKER, "1", "WXYZ11", 10, 10, 90, 900]]),
      sheet("Renda Fixa", [
        ["Produto", "Valor"],
        ["CDB - BANCO EXEMPLO", 1000],
      ]),
    ]);
    expect(parsed.kind).toBe("posicao");
    expect(parsed.positions.map((p) => [p.ticker, p.quantity, p.closePrice])).toEqual([
      ["ABCD3", "150", "12"],
      ["WXYZ11", "10", "90"],
    ]);
    expect(parsed.ignored).toEqual([
      expect.objectContaining({ label: "CDB - BANCO EXEMPLO", reason: "ativo_nao_listado" }),
    ]);
  });

  it("produto que começa com Total não é rodapé", () => {
    const parsed = parseB3Workbook([
      sheet("Fundos", [POS_HEADER, ["TOTAL RENDA - FUNDO", BROKER, "1", "TOTL11", 10, 10, 9, 90]]),
    ]);
    expect(parsed.positions.map((position) => position.ticker)).toEqual(["TOTL11"]);
  });
});

/** Nota fictícia, com a coluna do resumo à esquerda caindo na mesma linha, como sai do PDF. */
function noteLines(options: {
  number?: string;
  date?: string;
  trades: string[];
  liquidation?: string;
  emolumentos?: string;
  net?: string;
  settle?: string;
}) {
  const { number = "12345", date = "05/03/2026", trades } = options;
  return [
    "NOTA DE NEGOCIAÇÃO",
    "Nr. nota Folha Data pregão",
    `${number} 1 ${date}`,
    "CORRETORA EXEMPLO S.A. CNPJ 00.000.000/0001-00",
    "Cliente Fictícia da Silva C.P.F./C.N.P.J 000.000.000-00",
    "Rua Inventada, 100",
    "Negócios realizados",
    "Q Negociação C/V Tipo mercado Prazo Especificação do título Obs. (*) Quantidade Preço / Ajuste Valor Operação / Ajuste D/C",
    ...trades,
    "Resumo dos Negócios Resumo Financeiro",
    "Debêntures 0,00 Clearing",
    `Vendas à vista 0,00 Valor líquido das operações 1.000,00 D`,
    `Compras à vista 1.000,00 Taxa de liquidação ${options.liquidation ?? "0,25"} D`,
    "Opções - compras 0,00 Taxa de Registro 0,00 D",
    "Opções - vendas 0,00 Total CBLC 1.000,25 D",
    "Operações à termo 0,00 Bolsa",
    "Taxa de termo/opções 0,00 D",
    "Taxa A.N.A. 0,00 D",
    `Emolumentos ${options.emolumentos ?? "0,05"} D`,
    "Total Bovespa / Soma 0,05 D",
    "Custos Operacionais",
    "Taxa Operacional 0,00 D",
    "Execução 0,00",
    "Taxa de Custódia 0,00",
    "Impostos 0,00",
    "I.R.R.F. s/ operações, base R$0,00 0,00",
    "Outros 0,00 C",
    "Total Custos / Despesas 0,00 D",
    `Líquido para ${options.settle ?? "09/03/2026"} ${options.net ?? "1.000,30"} D`,
  ];
}

/** Nota no modelo da XP (2026): "Nº Nota" com a data antes do número, "Negociações" e subtotal por papel. */
function xpNoteLines(trades: string[]) {
  return [
    "Nota de Negociação",
    "Data da Consulta: 09/11/2026 21:33",
    "Data de Referência: 30/09/2026",
    "Cliente Fictícia da Silva C.P.F./C.N.P.J 000.000.000-00",
    "Conta XP 0000000",
    "Data pregão Nº Nota",
    "30/09/2026 145311273",
    "- N",
    "Banco Agência Conta Corrente Acionista Administrador Complemento nome",
    "Bovespa - Depósito / Vista",
    "Negociações",
    "Q Negociação C/V Tipo mercado Prazo Especificação do título Obs. (*) Quantidade Preço / Ajuste Valor Operação / Ajuste D/C",
    ...trades,
    "Resumo dos Negócios Resumo Financeiro D/C",
    "Debêntures 0,00 CBLC",
    "Vendas à Vista 1.590,00 Valor líquido das operações 1.446,04 C",
    "Compras à Vista 143,96 Taxa de liquidação 0,03 D",
    "Opções - Compras 0,00 Taxa de Registro 0,00",
    "Total CBLC 1.446,01 C",
    "Taxa A.N.A. 0,00",
    "Emolumentos 0,00",
    "A coluna Q indica a Corretagem 0,00 D",
    "ISS*(SÃO PAULO) 0,00 D",
    "I.R.R.F. s/ operações, base R$0,00 0,00 D",
    "Total Corretagem / Despesas 0,00",
    "Líquido para 02/10/2026 1.446,01 C",
  ];
}

describe("nota no modelo da XP", () => {
  it("lê o cabeçalho com a data antes do número, a seção Negociações e ignora o subtotal", () => {
    const parsed = parseBrokerageNotes(
      xpNoteLines([
        "1-BOVESPA C VISTA FII TRX REAL TRXF11 CI @ 2 71,98 143,96 D",
        "FII TRX REAL TRXF11 CI Quantidade Total: 2 Preço Médio: 71,9800",
        "1-BOVESPA V VISTA AMBEV S/A ABEV3 ON @# 100 15,90 1.590,00 C",
        "AMBEV S/A ABEV3 ON Quantidade Total: 100 Preço Médio: 15,9000",
      ]),
    );
    expect(parsed.ignored).toEqual([]);
    expect(parsed.trades).toEqual([
      expect.objectContaining({
        ticker: "TRXF11",
        side: "compra",
        date: "2026-09-30",
        quantity: "2",
        unitPrice: "71.98",
        doubt: null,
      }),
      expect.objectContaining({
        ticker: "ABEV3",
        side: "venda",
        date: "2026-09-30",
        quantity: "100",
        unitPrice: "15.9",
        doubt: null,
      }),
    ]);
    // A taxa de liquidação é rateada pelo valor das linhas.
    expect(parsed.trades.map((row) => row.fees)).toEqual(["0.00", "0.03"]);
  });

  it("taxa de transferência de ativos e 'Outras Bovespa' entram no custo, e a nota fecha", () => {
    // Resumo real de uma nota da XP (modelo SINACOR, 2026-08): sem essas duas taxas a nota não fechava.
    const lines = [
      "NOTA DE NEGOCIAÇÃO",
      "Nr. nota Folha Data pregão",
      "141275067 1 03/08/2026",
      "Negócios realizados",
      "Q Negociação C/V Tipo mercado Prazo Especificação do título Obs. (*) Quantidade Preço / Ajuste Valor Operação / Ajuste D/C",
      "1-BOVESPA V VISTA CAIXA SEGURI CXSE3 ON NM @# 100 19,88 1.988,00 C",
      "Resumo dos Negócios Resumo Financeiro",
      "Vendas à vista 1.988,00 Valor líquido das operações 1.988,00 C",
      "Compras à vista 0,00 Taxa de liquidação 0,50 D",
      "Emolumentos 0,10 D",
      "Taxa de Transf. de Ativos 0,57 D",
      "Taxa Operacional 8,00 D",
      "Impostos 0,90 D",
      "I.R.R.F. s/ operações, base R$1.988,00 0,10 D",
      "Outras Bovespa 0,01 D",
      "Total Custos / Despesas 10,08 D",
      "Líquido para 05/08/2026 1.977,82 C",
    ];
    const parsed = parseBrokerageNotes(lines);
    expect(parsed.trades).toEqual([
      expect.objectContaining({ ticker: "CXSE3", side: "venda", fees: "10.08", doubt: null }),
    ]);
  });

  it("segunda folha com o mesmo cabeçalho continua a mesma nota", () => {
    const lines = xpNoteLines(["1-BOVESPA C VISTA FII TRX REAL TRXF11 CI @ 2 71,98 143,96 D"]);
    const second = [
      "Data pregão Nº Nota",
      "30/09/2026 145311273",
      "Negociações",
      "1-BOVESPA V VISTA AMBEV S/A ABEV3 ON @# 100 15,90 1.590,00 C",
    ];
    const at = lines.findIndex((line) => line.startsWith("Resumo dos Negócios"));
    const parsed = parseBrokerageNotes([...lines.slice(0, at), ...second, ...lines.slice(at)]);
    expect(parsed.trades.map((row) => [row.ticker, row.side])).toEqual([
      ["TRXF11", "compra"],
      ["ABEV3", "venda"],
    ]);
  });
});

describe("nota de corretagem", () => {
  const buy = "1-BOVESPA C VISTA ABCD SA ON NM # 100 10,00 1.000,00 D";

  it("lê data, operação e taxas, com o resumo da esquerda na mesma linha", () => {
    const parsed = parseBrokerageNotes(noteLines({ trades: [buy] }));
    expect(parsed.kind).toBe("nota");
    expect(parsed.trades).toEqual([
      expect.objectContaining({
        ticker: null,
        title: "ABCD SA ON NM",
        side: "compra",
        date: "2026-03-05",
        quantity: "100",
        unitPrice: "10",
        fees: "0.30",
        doubt: null,
      }),
    ]);
  });

  it("não deixa escapar nome, CPF, endereço nem número da nota", () => {
    const text = JSON.stringify(parseBrokerageNotes(noteLines({ trades: [buy] })));
    expect(text).not.toMatch(/Fict|000\.000|Inventada|12345|CORRETORA/i);
  });

  it("rateia as taxas pelo valor de cada linha, sem perder centavo", () => {
    const parsed = parseBrokerageNotes(
      noteLines({
        trades: [
          "1-BOVESPA C VISTA ABCD3 ON 75 10,00 750,00 D",
          "1-BOVESPA C VISTA WXYZ11 CI 25 10,00 250,00 D",
        ],
        liquidation: "0,25",
        emolumentos: "0,06",
        net: "1.000,31",
      }),
    );
    expect(parsed.trades.map((t) => [t.ticker, t.fees])).toEqual([
      ["ABCD3", "0.23"],
      ["WXYZ11", "0.08"],
    ]);
  });

  it("fracionário, B3 RV LISTADO e day trade: mesma leitura", () => {
    const parsed = parseBrokerageNotes(
      noteLines({
        trades: [
          "B3 RV LISTADO C FRACIONARIO ABCD3F ON 5 10,00 50,00 D",
          "B3 RV LISTADO C FRACIONÁRIO ABCD3F ON D 95 10,00 950,00 D",
        ],
      }),
    );
    expect(parsed.trades.map((t) => [t.ticker, t.quantity, t.title])).toEqual([
      ["ABCD3", "5", "ABCD3F ON"],
      ["ABCD3", "95", "ABCD3F ON"],
    ]);
  });

  it("deixa opção de fora e a conta da nota continua fechando", () => {
    const parsed = parseBrokerageNotes(
      noteLines({
        trades: [
          "1-BOVESPA C VISTA ABCD3 ON 90 10,00 900,00 D",
          "1-BOVESPA C OPCAO DE COMPRA 03/26 ABCDC100 ON 100 1,00 100,00 D",
        ],
      }),
    );
    expect(parsed.trades).toHaveLength(1);
    expect(parsed.trades[0]!.doubt).toBeNull();
    expect(parsed.trades[0]!.fees).toBe("0.27");
    expect(parsed.ignored).toEqual([expect.objectContaining({ reason: "mercado_nao_suportado" })]);
  });

  it("nota que não fecha fica para conferir", () => {
    const parsed = parseBrokerageNotes(noteLines({ trades: [buy], net: "1.100,30" }));
    expect(parsed.trades[0]!.doubt).toBe("nota_nao_fecha");
    const noNet = noteLines({ trades: [buy] }).filter((line) => !line.startsWith("Líquido"));
    expect(parseBrokerageNotes(noNet).trades[0]!.doubt).toBe("nota_nao_fecha");
  });

  it("aceita o líquido com ou sem IRRF", () => {
    const sell = noteLines({
      trades: ["1-BOVESPA V VISTA ABCD3 ON 100 10,00 1.000,00 C"],
      net: "999,70",
    }).map((line) =>
      line
        .replace("Líquido para 09/03/2026 999,70 D", "Líquido para 09/03/2026 999,65 C")
        .replace("base R$0,00 0,00", "base R$1.000,00 0,05"),
    );
    const parsed = parseBrokerageNotes(sell);
    expect(parsed.trades[0]).toMatchObject({ side: "venda", fees: "0.30", doubt: null });
  });

  it("junta as folhas da mesma nota e separa notas diferentes", () => {
    const first = noteLines({ trades: ["1-BOVESPA C VISTA ABCD3 ON 60 10,00 600,00 D"] }).map(
      (line, index) => (index > 8 ? line.replace(/\d+,\d{2}( [DC])?$/, "CONTINUA...") : line),
    );
    const second = noteLines({ trades: ["1-BOVESPA C VISTA ABCD3 ON 40 10,00 400,00 D"] });
    const other = noteLines({
      number: "12346",
      date: "06/03/2026",
      trades: ["1-BOVESPA C VISTA WXYZ11 CI 100 10,00 1.000,00 D"],
    });
    const parsed = parseBrokerageNotes([...first, ...second, ...other]);
    expect(parsed.trades.map((t) => [t.ticker, t.date, t.fees, t.doubt])).toEqual([
      ["ABCD3", "2026-03-05", "0.18", null],
      ["ABCD3", "2026-03-05", "0.12", null],
      ["WXYZ11", "2026-03-06", "0.30", null],
    ]);
  });

  it("linha de negócio que não dá para ler põe a nota em dúvida, sem inventar operação", () => {
    const parsed = parseBrokerageNotes(
      noteLines({ trades: [buy, "1-BOVESPA X VISTA LINHA QUEBRADA 1,00"] }),
    );
    expect(parsed.trades[0]!.doubt).toBe("nota_nao_fecha");
    expect(parsed.ignored).toEqual([expect.objectContaining({ reason: "dados_invalidos" })]);
  });

  it("PDF sem texto e outro documento dão mensagem própria", () => {
    expect(failure(() => parseBrokerageNotes([]))).toBe("pdf_sem_texto");
    expect(failure(() => parseBrokerageNotes(["   ", ""]))).toBe("pdf_sem_texto");
    expect(failure(() => parseBrokerageNotes(["Fatura do cartão", "Total 100,00"]))).toBe("layout");
    expect(failure(() => parseBrokerageNotes(noteLines({ trades: [] })))).toBe("sem_linhas");
  });
});

describe("rateio", () => {
  it("fecha o total em qualquer divisão", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_00 }),
        fc.array(fc.integer({ min: 1, max: 10_000_000 }), { minLength: 1, maxLength: 30 }),
        (cents, weights) => {
          const shares = shareFees((cents / 100).toFixed(2), weights.map(String));
          const sum = shares.reduce((acc, share) => acc.plus(share), money(0));
          expect(sum.toFixed(2)).toBe((cents / 100).toFixed(2));
          expect(shares.every((share) => money(share).gte(0))).toBe(true);
        },
      ),
    );
  });

  it("taxa zerada ou devolvida não rateia nada", () => {
    expect(shareFees("0.00", ["10"])).toEqual(["0.00"]);
    expect(shareFees("-1.00", ["10", "20"])).toEqual(["0.00", "0.00"]);
    expect(shareFees("1.00", [])).toEqual([]);
  });
});

const trade = (over: Partial<ParsedTrade> & { line: number }): ParsedTrade => ({
  ticker: "ABCD3",
  title: null,
  side: "compra",
  date: "2026-03-05",
  quantity: "100",
  unitPrice: "10",
  fees: "0.00",
  doubt: null,
  ...over,
});

let nextId = 0;
const known = (row: Partial<KnownTrade>): KnownTrade => ({
  id: `t${(nextId += 1)}`,
  side: "compra",
  occurredOn: "2026-03-05",
  quantity: "100",
  unitPrice: "10",
  fees: "0",
  transactionId: null,
  ...row,
});

const holding = (trades: KnownTrade[], over: Partial<KnownHolding> = {}): KnownHolding => ({
  id: "inv-abcd",
  name: "ABCD",
  ticker: "ABCD3",
  assetClass: "acao",
  trades,
  events: [],
  ...over,
});

const states = (rows: PlannedTrade[]) => rows.map((row) => row.state);

/** Grava o plano numa carteira de mentira, como faria o servidor. */
function applyPlan(rows: PlannedTrade[], book: KnownHolding[]): KnownHolding[] {
  const next = book.map((item) => ({ ...item, trades: [...item.trades] }));
  for (const row of rows) {
    if (!selectedByDefault(row)) continue;
    let target = next.find((item) => item.ticker === row.ticker);
    if (row.state === "taxas") {
      for (const update of row.feeUpdates) {
        const found = target!.trades.find((item) => item.id === update.tradeId)!;
        found.fees = update.fees;
      }
      continue;
    }
    if (!target) {
      target = holding([], { id: `inv-${row.ticker}`, ticker: row.ticker });
      next.push(target);
    }
    target.trades.push(
      known({
        side: row.side,
        occurredOn: row.date,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        fees: row.fees,
      }),
    );
  }
  return next;
}

const importFile = (file: ParsedTrade[], book: KnownHolding[]) => {
  const rows = planInvestmentImport({ trades: file, holdings: book });
  return { rows, book: applyPlan(rows, book) };
};

describe("idempotência", () => {
  it("o mesmo arquivo duas vezes não duplica", () => {
    const file = [
      trade({ line: 1 }),
      trade({ line: 2, date: "2026-03-06", unitPrice: "10.5" }),
      trade({ line: 3, date: "2026-03-09", side: "venda", quantity: "50", unitPrice: "12" }),
    ];
    const first = importFile(file, []);
    expect(states(first.rows)).toEqual(["novo", "novo", "novo"]);
    const second = importFile(file, first.book);
    expect(states(second.rows)).toEqual(["existe", "existe", "existe"]);
    expect(second.book[0]!.trades).toHaveLength(3);
  });

  it("guarda duas operações iguais no mesmo dia, e completa só a que falta", () => {
    const file = [trade({ line: 1 }), trade({ line: 2 })];
    const first = importFile(file, []);
    expect(first.book[0]!.trades).toHaveLength(2);
    expect(states(importFile(file, first.book).rows)).toEqual(["existe", "existe"]);
    const partial = holding([known({})]);
    expect(states(importFile(file, [partial]).rows)).toEqual(["existe", "novo"]);
  });

  it("sobreposição parcial de períodos só cria o que é novo", () => {
    const line = (index: number, date: string) =>
      trade({ line: index, date, unitPrice: `1${index}` });
    const january = [line(1, "2026-01-05"), line(2, "2026-01-20"), line(3, "2026-02-03")];
    const february = [line(1, "2026-01-20"), line(2, "2026-02-03"), line(3, "2026-02-10")];
    // Os preços acompanham a data, para o segundo arquivo repetir de verdade.
    const fixed = february.map((row, index) => ({ ...row, unitPrice: `1${index + 2}` }));
    const first = importFile(january, []);
    const second = importFile(fixed, first.book);
    expect(states(second.rows)).toEqual(["existe", "existe", "novo"]);
    expect(second.book[0]!.trades).toHaveLength(4);
  });

  it("nota depois da Negociação não duplica e traz as taxas", () => {
    const negociacao = [trade({ line: 1 })];
    const { book } = importFile(negociacao, []);
    const nota = importFile([trade({ line: 7, fees: "0.30", title: "ABCD SA ON" })], book);
    expect(states(nota.rows)).toEqual(["taxas"]);
    expect(nota.book[0]!.trades).toHaveLength(1);
    expect(nota.book[0]!.trades[0]!.fees).toBe("0.30");
    // Terceira vez: nada muda.
    expect(states(importFile([trade({ line: 7, fees: "0.30" })], nota.book).rows)).toEqual([
      "existe",
    ]);
  });

  it("Negociação depois da nota não duplica nem zera as taxas", () => {
    const { book } = importFile([trade({ line: 1, fees: "0.30" })], []);
    const again = importFile([trade({ line: 2 })], book);
    expect(states(again.rows)).toEqual(["existe"]);
    expect(again.book[0]!.trades[0]!.fees).toBe("0.30");
  });

  it("nota que junta o que a Negociação separa é a mesma operação", () => {
    const { book } = importFile(
      [trade({ line: 1, unitPrice: "10.00" }), trade({ line: 2, unitPrice: "10.10" })],
      [],
    );
    const nota = importFile(
      [trade({ line: 9, quantity: "200", unitPrice: "10.05", fees: "0.40" })],
      book,
    );
    expect(states(nota.rows)).toEqual(["taxas"]);
    expect(nota.book[0]!.trades).toHaveLength(2);
    expect(nota.book[0]!.trades.map((row) => row.fees)).toEqual(["0.20", "0.20"]);
  });

  it("Negociação que separa o que a nota juntou é a mesma operação", () => {
    const { book } = importFile(
      [trade({ line: 9, quantity: "200", unitPrice: "10.05", fees: "0.40" })],
      [],
    );
    const rows = planInvestmentImport({
      trades: [trade({ line: 1, unitPrice: "10.00" }), trade({ line: 2, unitPrice: "10.10" })],
      holdings: book,
    });
    expect(states(rows)).toEqual(["existe", "existe"]);
  });

  it("não mexe na taxa de operação ligada a uma conta", () => {
    const book = [holding([known({ transactionId: "lancamento" })])];
    expect(states(importFile([trade({ line: 1, fees: "0.30" })], book).rows)).toEqual(["existe"]);
  });

  it("taxa de nota que não fecha não entra em operação já registrada", () => {
    const book = [holding([known({})])];
    const rows = planInvestmentImport({
      trades: [trade({ line: 1, fees: "0.30", doubt: "nota_nao_fecha" })],
      holdings: book,
    });
    expect(states(rows)).toEqual(["existe"]);
  });

  it("mesma quantidade com outro preço no mesmo dia é dúvida, não a mesma operação", () => {
    const book = [holding([known({ quantity: "1", unitPrice: "1.00" })])];
    const rows = planInvestmentImport({
      trades: [trade({ line: 1, quantity: "1", unitPrice: "1.01" })],
      holdings: book,
    });
    expect(rows[0]).toMatchObject({ state: "conferir", doubtReason: "parecida" });
  });

  it("mesmo dia e mesma ação com outra quantidade fica para conferir", () => {
    const book = [holding([known({ quantity: "60" })])];
    const rows = planInvestmentImport({ trades: [trade({ line: 1 })], holdings: book });
    expect(rows[0]).toMatchObject({ state: "conferir", doubtReason: "parecida" });
    expect(selectedByDefault(rows[0]!)).toBe(false);
  });

  it("Movimentação com data diferente por feriado fica para conferir, nunca duplica calada", () => {
    const book = [holding([known({ occurredOn: "2026-03-03" })])];
    const near = planInvestmentImport({
      trades: [trade({ line: 1, date: "2026-03-05" })],
      holdings: book,
    });
    expect(near[0]).toMatchObject({ state: "conferir", doubtReason: "parecida" });
    const far = planInvestmentImport({
      trades: [trade({ line: 1, date: "2026-03-20" })],
      holdings: book,
    });
    expect(far[0]!.state).toBe("novo");
  });

  it("nota em dúvida nasce desmarcada", () => {
    const rows = planInvestmentImport({
      trades: [trade({ line: 1, doubt: "nota_nao_fecha" })],
      holdings: [],
    });
    expect(rows[0]).toMatchObject({ state: "conferir", doubtReason: "nota_nao_fecha" });
  });

  it("qualquer divisão em períodos sobrepostos dá a mesma carteira", () => {
    const operation = fc.record({
      day: fc.integer({ min: 1, max: 28 }),
      quantity: fc.integer({ min: 1, max: 500 }),
      cents: fc.integer({ min: 100, max: 20000 }),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(operation, {
          minLength: 1,
          maxLength: 12,
          selector: (row) => `${row.day}|${row.quantity}|${row.cents}`,
        }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 1, max: 28 }),
        (rows, a, b) => {
          const all = [...rows]
            .sort((x, y) => x.day - y.day)
            .map((row, index) =>
              trade({
                line: index,
                date: `2026-03-${String(row.day).padStart(2, "0")}`,
                quantity: String(row.quantity),
                unitPrice: (row.cents / 100).toFixed(2),
              }),
            );
          // Os extratos da B3 são recortados por data: um dia nunca fica pela metade.
          const dayOf = (row: ParsedTrade) => Number(row.date.slice(-2));
          const before = all.filter((row) => dayOf(row) <= Math.max(a, b));
          const after = all.filter((row) => dayOf(row) > Math.min(a, b) - 1);
          fc.pre(new Set([...before, ...after]).size === all.length);
          const first = importFile(before, []);
          // Em dias vizinhos, a dúvida pode segurar a linha; a pessoa confirma.
          const second = planInvestmentImport({ trades: after, holdings: first.book });
          const accepted = second.map((row) =>
            row.state === "conferir" ? { ...row, state: "novo" as const } : row,
          );
          const final = applyPlan(accepted, first.book);
          const key = (row: { occurredOn: string; quantity: string; unitPrice: string }) =>
            `${row.occurredOn}|${row.quantity}|${row.unitPrice}`;
          const got = (final[0]?.trades ?? []).map(key).sort();
          const want = all
            .map((row) =>
              key({ occurredOn: row.date, quantity: row.quantity, unitPrice: row.unitPrice }),
            )
            .sort();
          expect(got).toEqual(want);
        },
      ),
    );
  });
});

describe("posição e venda", () => {
  it("compra e venda do mesmo arquivo em ordem de data, com a venda antes na lista", () => {
    const rows = planInvestmentImport({
      trades: [
        trade({ line: 1, side: "venda", date: "2026-03-09", quantity: "60" }),
        trade({ line: 2, side: "compra", date: "2026-03-05", quantity: "100" }),
      ],
      holdings: [],
    });
    expect(states(rows)).toEqual(["novo", "novo"]);
  });

  it("venda sem compra suficiente fica de fora, com a compra mantida", () => {
    const rows = planInvestmentImport({
      trades: [
        trade({ line: 1, side: "compra", date: "2026-03-05", quantity: "100" }),
        trade({ line: 2, side: "venda", date: "2026-03-06", quantity: "150" }),
        trade({ line: 3, side: "venda", date: "2026-03-07", quantity: "20" }),
      ],
      holdings: [],
    });
    expect(states(rows)).toEqual(["novo", "ignorado", "novo"]);
    expect(rows[1]!.ignoreReason).toBe("venda_maior_que_posicao");
  });

  it("conta o desdobramento já aplicado à carteira", () => {
    const book = [
      holding([known({ quantity: "100" })], { events: [{ comDate: "2026-03-06", factor: "2" }] }),
    ];
    const rows = planInvestmentImport({
      trades: [trade({ line: 1, side: "venda", date: "2026-03-09", quantity: "150" })],
      holdings: book,
    });
    expect(states(rows)).toEqual(["novo"]);
  });

  it("na confirmação, venda que dependia de compra desmarcada é recusada", () => {
    const rows = planInvestmentImport({
      trades: [
        trade({ line: 1, side: "compra", date: "2026-03-05", quantity: "100" }),
        trade({ line: 2, side: "venda", date: "2026-03-06", quantity: "100" }),
      ],
      holdings: [],
      selected: new Set([2]),
    });
    expect(rows[1]).toMatchObject({ state: "ignorado", ignoreReason: "venda_maior_que_posicao" });
  });

  it("ativo sem cotação na família não recebe operação", () => {
    const rows = planInvestmentImport({
      trades: [trade({ line: 1 })],
      holdings: [holding([], { assetClass: "renda_fixa" })],
    });
    expect(rows[0]).toMatchObject({ state: "ignorado", ignoreReason: "classe_sem_cotacao" });
  });

  it("linha sem código não entra até a pessoa informar", () => {
    const rows = planInvestmentImport({
      trades: [trade({ line: 1, ticker: null, title: "EMPRESA X ON" })],
      holdings: [],
    });
    expect(rows[0]).toMatchObject({ state: "ignorado", ignoreReason: "sem_codigo" });
  });

  it("compara a Posição com a carteira, e só o que falta pode virar operação", () => {
    const book = [
      holding([known({ quantity: "100" })]),
      holding([known({ quantity: "80" })], { id: "b", ticker: "WXYZ11" }),
      holding([known({ quantity: "20" })], { id: "c", ticker: "QWER4" }),
    ];
    const rows = planPositions(
      [
        { line: 1, ticker: "ABCD3", name: null, quantity: "100", closePrice: "12" },
        { line: 2, ticker: "WXYZ11", name: null, quantity: "50", closePrice: "90" },
        { line: 3, ticker: "QWER4", name: null, quantity: "30", closePrice: "10" },
        { line: 4, ticker: "ZZZZ3", name: "ZZZZ SA", quantity: "10", closePrice: null },
      ],
      book,
    );
    expect(rows.map((row) => [row.state, row.difference])).toEqual([
      ["confere", "0"],
      ["sobra", "-30"],
      ["falta", "10"],
      ["falta", "10"],
    ]);
  });
});

describe("ativo novo", () => {
  const catalog = new Map<string, CatalogAsset>([
    ["ABCD3", { ticker: "ABCD3", name: "ABCD SA ON NM", assetClass: "acao", close: "12" }],
    ["WXYZ11", { ticker: "WXYZ11", name: "WXYZ FII CI", assetClass: "fii", close: "90" }],
  ]);

  it("usa o catálogo e deduz o tipo só quando o código não deixa dúvida", () => {
    const assets = newAssetsOf(
      [{ ticker: "ABCD3" }, { ticker: "WXYZ11" }, { ticker: "QWER4" }, { ticker: "ASDF11" }],
      [],
      catalog,
    );
    expect(assets.map((a) => [a.ticker, a.name, a.assetClass, a.inCatalog])).toEqual([
      ["ABCD3", "ABCD SA ON NM", "acao", true],
      ["WXYZ11", "WXYZ FII CI", "fii", true],
      ["QWER4", "QWER4", "acao", false],
      ["ASDF11", "ASDF11", null, false],
    ]);
  });

  it("não recria o que a família já tem", () => {
    expect(newAssetsOf([{ ticker: "ABCD3" }], [holding([])], catalog)).toEqual([]);
  });

  it("deduz o tipo pelo final do código", () => {
    expect(guessAssetClass("ABCD3")).toBe("acao");
    expect(guessAssetClass("ABCD4")).toBe("acao");
    expect(guessAssetClass("ABCD34")).toBe("etf_bdr");
    expect(guessAssetClass("ABCD11")).toBeNull();
  });

  it("acha o código pelo título, só com um candidato", () => {
    const names = [
      { ticker: "ABCD3", name: "ABCD SA ON NM" },
      { ticker: "ABCD4", name: "ABCD SA PN N2" },
      { ticker: "DUPL3", name: "DUPLA ON" },
      { ticker: "DUPL5", name: "DUPLA ON" },
    ];
    expect(tickerOfTitle("ABCD SA ON EJ NM", names)).toBe("ABCD3");
    expect(tickerOfTitle("ABCD SA PN", names)).toBe("ABCD4");
    expect(tickerOfTitle("ABCD SA PNB", names)).toBeNull();
    expect(tickerOfTitle("DUPLA ON", names)).toBeNull();
    expect(tickerOfTitle("NADA CONHECIDA ON", names)).toBeNull();
  });

  it("carteira sem o tipo no nome também ajuda, conferindo o final do código", () => {
    const names = [{ ticker: "ABCD4", name: "Abcd SA" }];
    expect(tickerOfTitle("ABCD SA PN N2", names)).toBe("ABCD4");
    expect(tickerOfTitle("ABCD SA ON", names)).toBeNull();
  });

  it("o código digitado vale mais que o achado, e o título vira código nas linhas iguais", () => {
    const rows = withResolvedTickers(
      [
        trade({ line: 1, ticker: null, title: "ABCD SA ON NM" }),
        trade({ line: 2, ticker: null, title: "ABCD SA ON NM" }),
        trade({ line: 3, ticker: "WXYZ11" }),
      ],
      [{ ticker: "ABCD3", name: "ABCD SA ON NM" }],
      { "ABCD SA ON NM": "qwer4f" },
    );
    expect(rows.map((row) => row.ticker)).toEqual(["QWER4", "QWER4", "WXYZ11"]);
  });
});

describe("código pela emissora da B3 (ADR-0036)", () => {
  const issuers = [
    { issuer: "CXSE", tradingName: "CAIXA SEGURI", kind: "acao" as const },
    { issuer: "PETR", tradingName: "PETROBRAS", kind: "acao" as const },
    { issuer: "SANB", tradingName: "SANTANDER BR", kind: "acao" as const },
    { issuer: "AAPL", tradingName: "APPLE", kind: "bdr" as const },
    // Duas emissoras com o mesmo nome de pregão: ninguém responde.
    { issuer: "ACEE", tradingName: "ACELEN", kind: "acao" as const },
    { issuer: "ACIL", tradingName: "ACELEN", kind: "acao" as const },
  ];

  it("nome de pregão mais o tipo viram raiz mais final", () => {
    expect(tickerOfIssuer("CAIXA SEGURI ON NM", issuers)).toBe("CXSE3");
    expect(tickerOfIssuer("PETROBRAS PN N2", issuers)).toBe("PETR4");
    expect(tickerOfIssuer("Petrobras ON EJ N2", issuers)).toBe("PETR3");
    expect(tickerOfIssuer("SANTANDER BR UNT", issuers)).toBe("SANB11");
  });

  it("sem tipo, com nome repetido, BDR ou fundo, fica para o catálogo ou para a pessoa", () => {
    expect(tickerOfIssuer("PETROBRAS", issuers)).toBeNull();
    expect(tickerOfIssuer("ACELEN ON", issuers)).toBeNull();
    expect(tickerOfIssuer("APPLE DRN", issuers)).toBeNull();
    expect(tickerOfIssuer("FII MAXI REN CI ER", issuers)).toBeNull();
    expect(tickerOfIssuer("NADA ON", issuers)).toBeNull();
  });

  it("na resolução das linhas, a emissora vem antes do catálogo e depois do que a pessoa digitou", () => {
    const rows = withResolvedTickers(
      [
        trade({ line: 1, ticker: null, title: "CAIXA SEGURI ON NM" }),
        trade({ line: 2, ticker: null, title: "PETROBRAS PN N2" }),
        trade({ line: 3, ticker: null, title: "OUTRA ON" }),
      ],
      [{ ticker: "OUTR3", name: "OUTRA ON" }],
      { "PETROBRAS PN N2": "petr3" },
      issuers,
    );
    expect(rows.map((row) => row.ticker)).toEqual(["CXSE3", "PETR3", "OUTR3"]);
  });
});

describe("posição continua fechando depois de importar", () => {
  it("preço médio soma as taxas rateadas", () => {
    const { book } = importFile([trade({ line: 1, unitPrice: "10", fees: "0.30" })], []);
    expect(positionOf(book[0]!.trades).cost).toBe("1000.30");
  });
});
