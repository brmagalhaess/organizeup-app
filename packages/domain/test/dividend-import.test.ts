// Importar proventos (ADR-0029). Fixtures fictícias com o layout citado em `src/dividend-file.ts`: não há arquivo
// real no repositório. As contas de JCP vêm do ADR-0017: 15% até 2025 e 17,5% desde 2026.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkDividendFile,
  columnsComplete,
  daysApart,
  dividendCsvColumns,
  DividendFileError,
  dividendSelectable,
  dividendSelectedByDefault,
  importedDividendId,
  isImportedDividend,
  jcpFromNet,
  money,
  parseCsvTable,
  parseDividendFile,
  planDividendImport,
  proventoAmounts,
  reconcileProventos,
  sameProventoKind,
  toDbAmount,
  type DividendHolding,
  type DividendKind,
  type ExistingDividend,
  type MarketEventRef,
  type MarketProvento,
  type ParsedDividend,
  type SheetCell,
  type TradeInput,
} from "../src";

const RECEBIDOS_HEADER = [
  "Produto",
  "Pagamento",
  "Tipo de Evento",
  "Instituição",
  "Quantidade",
  "Preço unitário",
  "Valor líquido",
];
const MOVIMENTACAO_HEADER = [
  "Entrada/Saída",
  "Data",
  "Movimentação",
  "Produto",
  "Instituição",
  "Quantidade",
  "Preço unitário",
  "Valor da Operação",
];
const BROKER = "CORRETORA EXEMPLO S.A.";

const recebidos = (...rows: SheetCell[][]) =>
  parseDividendFile({
    format: "xlsx",
    sheets: [{ name: "Proventos", rows: [RECEBIDOS_HEADER, ...rows] }],
  });
const movimentacao = (...rows: SheetCell[][]) =>
  parseDividendFile({
    format: "xlsx",
    sheets: [{ name: "Movimentação", rows: [MOVIMENTACAO_HEADER, ...rows] }],
  });
const csv = (text: string) => parseDividendFile({ format: "csv", text });

const failure = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof DividendFileError ? error.code : "outro";
  }
  return null;
};

describe("Proventos recebidos", () => {
  it("lê cada tipo, em números e em texto, e guarda só o que vai ao servidor", () => {
    const parsed = recebidos(
      ["ABCD3 - ABCD SA", "15/01/2026", "Dividendo", BROKER, 100, 1.2, 120],
      ["FICT11 - FICT FII", "14/01/2026", "Rendimento", BROKER, "1.350", 0.17, "229,50"],
      ["WXYZ4 - WXYZ SA", "02/01/2026", "Juros Sobre Capital Próprio", BROKER, 370, 0.02, 5.55],
      ["Total líquido", null, null, null, null, null, 355.05],
    );
    expect(parsed.kind).toBe("recebidos");
    expect(parsed.ignored).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        line: 2,
        ticker: "ABCD3",
        kind: "dividendo",
        paidOn: "2026-01-15",
        gross: null,
        withheld: null,
        net: "120.00",
      },
      {
        line: 3,
        ticker: "FICT11",
        kind: "rendimento",
        paidOn: "2026-01-14",
        gross: null,
        withheld: null,
        net: "229.50",
      },
      {
        line: 4,
        ticker: "WXYZ4",
        kind: "jcp",
        paidOn: "2026-01-02",
        gross: null,
        withheld: null,
        net: "5.55",
      },
    ]);
  });

  it("lê todas as abas, pula título de mês e cabeçalho repetido, e a linha não se repete", () => {
    const parsed = parseDividendFile({
      format: "xlsx",
      sheets: [
        { name: "Janeiro", rows: [["Relatório"], RECEBIDOS_HEADER] },
        {
          name: "Fevereiro",
          rows: [
            RECEBIDOS_HEADER,
            ["Fevereiro de 2026"],
            ["ABCD3 - ABCD SA", "15/02/2026", "Dividendo", BROKER, 1, 1, 1],
            RECEBIDOS_HEADER,
            ["ABCD3 - ABCD SA", "16/02/2026", "Dividendo", BROKER, 1, 1, 1],
          ],
        },
      ],
    });
    expect(parsed.rows.map((row) => row.paidOn)).toEqual(["2026-02-15", "2026-02-16"]);
    expect(new Set(parsed.rows.map((row) => row.line)).size).toBe(2);
  });

  it("recusa outro layout e arquivo sem linhas", () => {
    const sheet = (rows: SheetCell[][]) => ({
      format: "xlsx" as const,
      sheets: [{ name: "A", rows }],
    });
    expect(
      failure(() =>
        parseDividendFile(
          sheet([
            ["Nome", "Telefone"],
            ["Ana", "1"],
          ]),
        ),
      ),
    ).toBe("layout");
    expect(failure(() => recebidos())).toBe("sem_linhas");
    const many = Array.from({ length: 2001 }, () => [
      "ABCD3 - ABCD SA",
      "15/01/2026",
      "Dividendo",
      BROKER,
      1,
      1,
      1,
    ]);
    expect(failure(() => recebidos(...many))).toBe("muitas_linhas");
  });

  it("ignora com motivo reembolso, Tesouro, tipo novo, valor zero e fórmula", () => {
    const parsed = recebidos(
      ["ABCD3 - ABCD SA", "15/01/2026", "Reembolso", BROKER, 1, 1, 1],
      ["Tesouro Selic 2029", "15/01/2026", "Rendimento", BROKER, 1, 1, 1],
      ["ABCD3 - ABCD SA", "15/01/2026", "Bonificação", BROKER, 1, 1, 1],
      ["ABCD3 - ABCD SA", "15/01/2026", "Dividendo", BROKER, 1, 1, 0],
      ["ABCD3 - ABCD SA", "15/01/2026", "Dividendo", BROKER, 1, 1, "=1+1"],
      ["ABCD3 - ABCD SA", "-", "Dividendo", BROKER, 1, 1, 1],
      ["=cmd() - ABCD", "15/01/2026", "Dividendo", BROKER, 1, 1, 1],
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.ignored.map((line) => line.reason)).toEqual([
      "reembolso",
      "ativo_nao_listado",
      "tipo_desconhecido",
      "dados_invalidos",
      "dados_invalidos",
      "dados_invalidos",
      "ativo_nao_listado",
    ]);
    expect(parsed.ignored[6]!.label).toBe("—");
  });
});

describe("Movimentação", () => {
  it("só crédito de provento entra; repetido, débito e o resto ficam de fora com motivo", () => {
    const parsed = movimentacao(
      ["Credito", "10/03/2026", "Dividendo", "ABCD3 - ABCD SA", BROKER, 105, 0.5, 52.5],
      [
        "Credito",
        "11/03/2026",
        "Juros Sobre Capital Próprio",
        "ABCD3 - ABCD SA",
        BROKER,
        1,
        1,
        8.25,
      ],
      ["Credito", "12/03/2026", "Rendimento", "FICT11 - FICT", BROKER, 10, 1, 10],
      ["Debito", "12/03/2026", "Rendimento - Transferido", "FICT11 - FICT", BROKER, 10, 1, 10],
      ["Credito", "12/03/2026", "Dividendo - Transferido", "ABCD3 - ABCD SA", BROKER, 1, 1, 1],
      ["Debito", "13/03/2026", "Dividendo", "ABCD3 - ABCD SA", BROKER, 1, 1, 1],
      ["Credito", "09/03/2026", "Transferência - Liquidação", "ABCD3 - ABCD SA", BROKER, 1, 10, 10],
      ["Credito", "09/03/2026", "Desdobro", "ABCD3 - ABCD SA", BROKER, 1, null, null],
      ["Credito", "09/03/2026", "Reembolso", "ABCD3 - ABCD SA", BROKER, 1, 1, 1],
    );
    expect(parsed.kind).toBe("movimentacao");
    expect(parsed.rows.map((row) => [row.ticker, row.kind, row.net])).toEqual([
      ["ABCD3", "dividendo", "52.50"],
      ["ABCD3", "jcp", "8.25"],
      ["FICT11", "rendimento", "10.00"],
    ]);
    expect(parsed.ignored.map((line) => line.reason)).toEqual([
      "transferido",
      "transferido",
      "debito",
      "outra_movimentacao",
      "outra_movimentacao",
      "reembolso",
    ]);
  });
});

describe("CSV genérico", () => {
  it("acha as colunas pelo título, com bruto, retido e líquido", () => {
    const parsed = csv(
      [
        "Data;Ativo;Tipo;Bruto;IR;Líquido;Nome;CPF",
        "15/01/2026;ABCD3;JCP;100,00;17,50;82,50;Pessoa Ficticia;000.000.000-00",
        "16/01/2026;FICT11;Rendimento;10,00;0,00;10,00;Pessoa Ficticia;000.000.000-00",
      ].join("\n"),
    );
    expect(parsed.kind).toBe("csv");
    expect(parsed.rows).toEqual([
      {
        line: 2,
        ticker: "ABCD3",
        kind: "jcp",
        paidOn: "2026-01-15",
        gross: "100.00",
        withheld: "17.50",
        net: "82.50",
      },
      {
        line: 3,
        ticker: "FICT11",
        kind: "rendimento",
        paidOn: "2026-01-16",
        gross: "10.00",
        withheld: "0.00",
        net: "10.00",
      },
    ]);
    expect(JSON.stringify(parsed.rows)).not.toMatch(/Pessoa|000\.000/);
  });

  it("coluna só de valor conta como líquido, com outro separador e título antes", () => {
    const parsed = csv(
      "Meus proventos\nDate,Ticker,Type,Amount\n2026-01-15,abcd3f,Dividends,120.5\n",
    );
    expect(parsed.rows[0]).toMatchObject({
      line: 3,
      ticker: "ABCD3",
      kind: "dividendo",
      net: "120.50",
      gross: null,
    });
  });

  it("linha que não fecha ou sem código fica de fora; texto fica só no rótulo", () => {
    const parsed = csv(
      [
        "Data;Ativo;Tipo;Bruto;IR;Líquido",
        "15/01/2026;ABCD3;Dividendo;100,00;10,00;80,00",
        "15/01/2026;Petrobras do João;Dividendo;100,00;0,00;100,00",
        "15/01/2026;ABCD3;Bônus;100,00;0,00;100,00",
      ].join("\n"),
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.ignored.map((line) => [line.label, line.reason])).toEqual([
      ["ABCD3", "valores_nao_fecham"],
      ["Petrobras do João", "ativo_nao_listado"],
      ["ABCD3", "tipo_desconhecido"],
    ]);
  });

  it("sem as colunas, lança `colunas`; com a escolha da pessoa, lê", () => {
    const text = "Quando;Papel;Natureza;Quanto\n15/01/2026;ABCD3;Dividendo;50,00\n";
    expect(failure(() => csv(text))).toBe("colunas");
    const columns = dividendCsvColumns(parseCsvTable(text));
    expect(columns).toMatchObject({ header: 0, asset: 1, date: -1, kind: -1, value: -1 });
    expect(columnsComplete(columns)).toBe(false);
    const chosen = { ...columns, date: 0, kind: 2, value: 3 };
    const parsed = parseDividendFile({ format: "csv", text, columns: chosen });
    expect(parsed.rows[0]).toMatchObject({ ticker: "ABCD3", net: "50.00" });
  });

  it("arquivo sem cabeçalho nem colunas não vira linha", () => {
    expect(failure(() => csv("apenas uma frase\n"))).toBe("colunas");
    expect(failure(() => csv(""))).toBe("vazio");
    const noTitles = "15/01/2026;ABCD3;Dividendo;50,00\n16/01/2026;ABCD3;Dividendo;60,00\n";
    expect(failure(() => csv(noTitles))).toBe("colunas");
    expect(dividendCsvColumns(parseCsvTable(noTitles)).header).toBe(-1);
  });
});

describe("conferência do arquivo", () => {
  const text = new TextEncoder().encode("Data;Ativo\n");
  const pdf = new TextEncoder().encode("%PDF-1.7");

  it("aceita CSV e recusa o que não é, pelo conteúdo", () => {
    expect(checkDividendFile(text, "proventos.csv")).toBe("csv");
    expect(failure(() => checkDividendFile(new Uint8Array(), "a.csv"))).toBe("vazio");
    expect(failure(() => checkDividendFile(pdf, "a.csv"))).toBe("tipo");
    expect(failure(() => checkDividendFile(new Uint8Array([0x50, 0x4b, 3, 4]), "a.csv"))).toBe(
      "tipo",
    );
    expect(failure(() => checkDividendFile(new Uint8Array(6 * 1024 * 1024), "a.csv"))).toBe(
      "tamanho",
    );
    expect(failure(() => checkDividendFile(pdf, "nota.pdf"))).toBe("tipo");
    expect(failure(() => checkDividendFile(text, "antigo.xls"))).toBe("xls_antigo");
  });
});

const row = (over: Partial<ParsedDividend> = {}): ParsedDividend => ({
  line: 1,
  ticker: "ABCD3",
  kind: "dividendo",
  paidOn: "2026-03-10",
  gross: null,
  withheld: null,
  net: "50.00",
  ...over,
});
const existing = (over: Partial<ExistingDividend> = {}): ExistingDividend => ({
  id: "d1",
  kind: "dividendo",
  paidOn: "2026-03-10",
  gross: "50.00",
  withheld: "0.00",
  source: "agente",
  marketDividendId: "m1",
  ...over,
});
const holding = (over: Partial<DividendHolding> = {}): DividendHolding => ({
  id: "inv-1",
  name: "ABCD",
  ticker: "ABCD3",
  assetClass: "acao",
  dividends: [],
  ...over,
});
const eventRef = (over: Partial<MarketEventRef> = {}): MarketEventRef => ({
  id: "m1",
  ticker: "ABCD3",
  kind: "dividendo",
  comDate: "2026-02-20",
  payDate: "2026-03-10",
  ...over,
});
const plan = (
  rows: ParsedDividend[],
  holdings: DividendHolding[] = [holding()],
  over: Partial<Parameters<typeof planDividendImport>[0]> = {},
) => planDividendImport({ rows, holdings, events: [], today: "2026-11-02", ...over });
const states = (planned: ReturnType<typeof plan>) => planned.map((item) => item.state);

describe("valores", () => {
  it("dividendo só com líquido: bruto igual, sem imposto e sem conta a mostrar", () => {
    const [planned] = plan([row()]);
    expect(planned).toMatchObject({
      state: "novo",
      investmentId: "inv-1",
      amounts: { gross: "50.00", withheld: "0.00", net: "50.00" },
      calculation: null,
    });
    expect(dividendSelectedByDefault(planned!)).toBe(true);
  });

  it("JCP só com líquido antes de 2026: 15%, calculado e avisado", () => {
    const [planned] = plan([row({ kind: "jcp", paidOn: "2025-06-10", net: "85.00" })]);
    expect(planned).toMatchObject({
      state: "novo",
      amounts: { gross: "100.00", withheld: "15.00", net: "85.00" },
      calculation: "jcp_do_liquido",
      rate: "0.15",
    });
  });

  it("JCP de 2026 com a data-com na fonte: 17,5%", () => {
    const events = [eventRef({ kind: "jcp", comDate: "2026-02-20" })];
    const [planned] = plan([row({ kind: "jcp", net: "82.50" })], [holding()], { events });
    expect(planned).toMatchObject({
      state: "novo",
      amounts: { gross: "100.00", withheld: "17.50", net: "82.50" },
      rate: "0.175",
    });
  });

  it("virada de ano: data-com em 2025 e pagamento em 2026 não ganha alíquota inventada", () => {
    const events = [eventRef({ kind: "jcp", comDate: "2025-12-20" })];
    const lines = [row({ kind: "jcp", net: "85.00" })];
    const [withEvent] = plan(lines, [holding()], { events });
    expect(withEvent).toMatchObject({
      state: "conferir",
      doubtReason: "imposto_incerto",
      amounts: { gross: "85.00", withheld: "0.00", net: "85.00" },
      calculation: null,
    });
    expect(dividendSelectable(withEvent!)).toBe(true);
    expect(dividendSelectedByDefault(withEvent!)).toBe(false);
  });

  it("JCP de 2026 sem data-com conhecida também fica para a pessoa", () => {
    expect(plan([row({ kind: "jcp", net: "82.50" })])[0]).toMatchObject({
      state: "conferir",
      doubtReason: "imposto_incerto",
    });
  });

  it("JCP só com bruto retém pela regra; bruto e líquido dão o retido pela diferença", () => {
    expect(
      plan([row({ kind: "jcp", paidOn: "2025-06-10", gross: "200.00", net: null })])[0],
    ).toMatchObject({
      amounts: { gross: "200.00", withheld: "30.00", net: "170.00" },
      calculation: "jcp_do_bruto",
    });
    expect(plan([row({ kind: "jcp", gross: "100.00", net: "82.00" })])[0]).toMatchObject({
      state: "novo",
      amounts: { gross: "100.00", withheld: "18.00", net: "82.00" },
      calculation: "retido_pela_diferenca",
    });
    expect(plan([row({ kind: "jcp", withheld: "18.00", net: "82.00" })])[0]).toMatchObject({
      amounts: { gross: "100.00", withheld: "18.00", net: "82.00" },
      calculation: "bruto_pela_soma",
    });
    expect(
      plan([row({ kind: "jcp", gross: "100.00", withheld: "18.00", net: "82.00" })])[0],
    ).toMatchObject({ calculation: null, amounts: { net: "82.00" } });
  });

  it("rendimento só é certo em FII", () => {
    const fii = holding({ assetClass: "fii" });
    expect(plan([row({ kind: "rendimento" })], [fii])[0]).toMatchObject({ state: "novo" });
    expect(plan([row({ kind: "rendimento" })])[0]).toMatchObject({
      state: "conferir",
      doubtReason: "imposto_incerto",
    });
  });

  it("dividendo acima de R$ 50 mil no mês: fica para conferir, se o arquivo não disse o retido", () => {
    const lines = [
      row({ net: "30000.00" }),
      row({ line: 2, paidOn: "2026-03-20", net: "30000.00" }),
    ];
    expect(states(plan(lines))).toEqual(["conferir", "conferir"]);
    expect(plan(lines)[0]!.doubtReason).toBe("acima_do_limite");
    const told = lines.map((line) => ({ ...line, gross: line.net, withheld: "0.00" }));
    expect(states(plan(told))).toEqual(["novo", "novo"]);
  });

  it("data futura fica de fora: quem cuida do a receber é o Mercado", () => {
    expect(plan([row({ paidOn: "2026-11-03" })])[0]).toMatchObject({
      state: "ignorado",
      ignoreReason: "data_futura",
    });
  });
});

describe("comparação com o que já existe", () => {
  const withRows = (...dividends: ExistingDividend[]) => [holding({ dividends })];

  it("linha automática igual já existe, com um centavo de folga", () => {
    expect(states(plan([row({ net: "50.01" })], withRows(existing())))).toEqual(["existe"]);
    expect(states(plan([row({ net: "50.02" })], withRows(existing())))).toEqual(["conferir"]);
  });

  it("a mesma data a poucos dias e dividendo contra rendimento contam como o mesmo", () => {
    const rows = [row({ paidOn: "2026-03-13", kind: "rendimento" })];
    expect(states(plan(rows, withRows(existing())))).toEqual(["existe"]);
  });

  it("a mais de 5 dias é outro provento, e JCP nunca é dividendo", () => {
    expect(states(plan([row({ paidOn: "2026-03-16" })], withRows(existing())))).toEqual(["novo"]);
    const jcp = row({ kind: "jcp", paidOn: "2025-03-10", gross: "50.00", net: null });
    expect(states(plan([jcp], withRows(existing({ paidOn: "2025-03-10" }))))).toEqual(["novo"]);
  });

  it("automática com valor bruto bate com o líquido do JCP e com a própria linha", () => {
    const auto = existing({ kind: "jcp", gross: "100.00", withheld: "17.50" });
    const rows = [row({ kind: "jcp", net: "82.50" })];
    expect(states(plan(rows, withRows(auto)))).toEqual(["existe"]);
  });

  it("valor diferente do automático: conferir, e marcar troca aquela linha", () => {
    expect(plan([row({ net: "70.00" })], withRows(existing()))[0]).toMatchObject({
      state: "conferir",
      doubtReason: "valor_diferente",
      replaces: "d1",
    });
  });

  it("duas corretoras no arquivo e uma linha no banco contam como a mesma", () => {
    const lines = [row({ net: "20.00" }), row({ line: 2, net: "30.00" })];
    expect(states(plan(lines, withRows(existing())))).toEqual(["existe", "existe"]);
  });

  it("uma linha no arquivo e dois pagamentos no banco também", () => {
    const rows = withRows(
      existing({ gross: "20.00" }),
      existing({ id: "d2", gross: "30.00", marketDividendId: "m2" }),
    );
    expect(states(plan([row()], rows))).toEqual(["existe"]);
  });

  it("dois pagamentos iguais no arquivo seguem sendo dois", () => {
    const lines = [row(), row({ line: 2 })];
    expect(states(plan(lines))).toEqual(["novo", "novo"]);
    const once = withRows(existing());
    expect(states(plan(lines, once))).toEqual(["existe", "novo"]);
    const twice = withRows(existing(), existing({ id: "d2", marketDividendId: "m2" }));
    expect(states(plan(lines, twice))).toEqual(["existe", "existe"]);
  });

  it("lançamento à mão igual já existe; diferente é conferir, sem trocar nada", () => {
    const manual = existing({ source: "familia", marketDividendId: null });
    expect(states(plan([row()], withRows(manual)))).toEqual(["existe"]);
    expect(plan([row({ net: "70.00" })], withRows(manual))[0]).toMatchObject({
      state: "conferir",
      doubtReason: "parecida",
      replaces: null,
    });
  });

  it("total à mão de JCP e dividendo cobre as duas linhas do arquivo", () => {
    const manual = existing({ source: "familia", marketDividendId: null, gross: "150.00" });
    const lines = [
      row({ net: "50.00" }),
      row({ line: 2, kind: "jcp", gross: "100.00", withheld: "0.00", net: "100.00" }),
    ];
    expect(states(plan(lines, withRows(manual)))).toEqual(["existe", "existe"]);
  });

  it("à mão de outro tipo por perto pede conferência: pode ser o total dos dois", () => {
    const manual = existing({ source: "familia", marketDividendId: null, gross: "150.00" });
    const line = row({ kind: "jcp", gross: "100.00", withheld: "0.00", net: "100.00" });
    expect(plan([line], withRows(manual))[0]).toMatchObject({
      state: "conferir",
      doubtReason: "parecida",
    });
  });

  it("provento que a família excluiu pede conferência", () => {
    const blocked = new Map([["inv-1", new Set(["m1"])]]);
    expect(plan([row()], [holding()], { events: [eventRef()], blocked })[0]).toMatchObject({
      state: "conferir",
      doubtReason: "excluido",
    });
  });
});

describe("ativo fora da carteira", () => {
  it("fica para conferir, sem caixa, até a pessoa escolher", () => {
    const [planned] = plan([row({ ticker: "QWER4" })]);
    expect(planned).toMatchObject({
      state: "conferir",
      doubtReason: "sem_ativo",
      investmentId: null,
      amounts: null,
    });
    expect(dividendSelectable(planned!)).toBe(false);
  });

  it("com a escolha, compara com aquele investimento; escolha de fora não vale", () => {
    const dividends = [existing({ id: "d9" })];
    const other = holding({ id: "inv-2", ticker: null, name: "Antigo", dividends });
    const rows = [row({ ticker: "QWER4" })];
    const holdings = [holding(), other];
    expect(plan(rows, holdings, { assignments: { QWER4: "inv-2" } })[0]).toMatchObject({
      state: "existe",
      investmentId: "inv-2",
    });
    expect(plan(rows, holdings, { assignments: { QWER4: "de-outra-familia" } })[0]).toMatchObject({
      state: "conferir",
      doubtReason: "sem_ativo",
    });
  });

  it("código em dois investimentos também pede escolha", () => {
    const holdings = [holding(), holding({ id: "inv-2" })];
    expect(plan([row()], holdings)[0]).toMatchObject({ doubtReason: "sem_ativo" });
    expect(plan([row()], holdings, { assignments: { ABCD3: "inv-2" } })[0]).toMatchObject({
      state: "novo",
      investmentId: "inv-2",
    });
  });
});

describe("Mercado e importação (ADR-0029)", () => {
  const trades: TradeInput[] = [
    { side: "compra", occurredOn: "2026-01-05", quantity: "100", unitPrice: "10", fees: "0" },
  ];
  const provento = (over: Partial<MarketProvento> = {}): MarketProvento => ({
    id: "m1",
    kind: "dividendo",
    comDate: "2026-02-20",
    payDate: "2026-03-10",
    ratePerShare: "0.5",
    ...over,
  });
  const imported = (over: Partial<ExistingDividend> = {}): ExistingDividend => ({
    ...existing({ source: "familia", marketDividendId: null }),
    id: importedDividendId("a"),
    ...over,
  });
  const reconcile = (events: MarketProvento[], rows: ExistingDividend[], blocked: string[] = []) =>
    reconcileProventos({
      assetClass: "acao",
      trades,
      events,
      existing: rows,
      blocked: new Set(blocked),
    });

  it("a marca está no id e só nele", () => {
    expect(isImportedDividend(importedDividendId("x"))).toBe(true);
    expect(isImportedDividend("0b1f0f5e-3c3e-4f5f-8a53-4b5ab2e0b1c7")).toBe(false);
  });

  it("linha importada responde pelo provento dela, sem duplicar", () => {
    const plan = reconcile([provento()], [imported()]);
    expect(plan.create).toEqual([]);
    expect(plan.skippedFamily).toBe(1);
  });

  it("e não bloqueia o JCP do mesmo dia nem outro pagamento na janela", () => {
    const events = [
      provento(),
      provento({ id: "m2", kind: "jcp", ratePerShare: "1" }),
      provento({ id: "m3", payDate: "2026-03-12" }),
    ];
    expect(reconcile(events, [imported()]).create.map((entry) => entry.marketDividendId)).toEqual([
      "m2",
      "m3",
    ]);
  });

  it("o lançamento à mão continua cobrindo tudo na janela", () => {
    const manual = existing({ source: "familia", marketDividendId: null });
    const events = [provento(), provento({ id: "m2", kind: "jcp", ratePerShare: "1" })];
    const plan = reconcile(events, [manual]);
    expect(plan.create).toEqual([]);
    expect(plan.skippedFamily).toBe(2);
  });

  it("dois pagamentos no mesmo dia: a linha fica com o de valor mais próximo", () => {
    const events = [provento({ ratePerShare: "0.9" }), provento({ id: "m2" })];
    const row50 = imported({ gross: "50.00" });
    expect(reconcile(events, [row50]).create.map((entry) => entry.marketDividendId)).toEqual([
      "m1",
    ]);
  });

  it("duas linhas importadas não reivindicam o mesmo provento", () => {
    const rows = [imported(), imported({ id: importedDividendId("b") })];
    const events = [provento(), provento({ id: "m2", ratePerShare: "0.4" })];
    expect(reconcile(events, rows).create).toEqual([]);
  });

  it("automática trocada pela família não é corrigida, nem tirada, nem recriada", () => {
    const swapped = existing({ source: "familia", gross: "70.00" });
    const plan = reconcile([provento()], [swapped]);
    expect(plan).toMatchObject({ create: [], update: [], remove: [] });
    expect(reconcile([], [swapped])).toMatchObject({ remove: [] });
  });

  it("provento excluído segue bloqueado, e a linha importada não vai atrás de outro", () => {
    const events = [provento(), provento({ id: "m2", payDate: "2026-03-11" })];
    const plan = reconcile(events, [imported()], ["m1"]);
    expect(plan.create.map((entry) => entry.marketDividendId)).toEqual(["m2"]);
  });

  it("rodar de novo sobre o resultado não muda nada", () => {
    const events = [provento(), provento({ id: "m2", kind: "jcp", ratePerShare: "1" })];
    const first = reconcile(events, [imported()]);
    const created = first.create.map((entry, index): ExistingDividend => ({
      ...entry,
      id: `novo-${index}`,
      source: "agente",
    }));
    const second = reconcile(events, [imported(), ...created]);
    expect(second).toMatchObject({ create: [], update: [], remove: [] });
  });
});

describe("propriedades", () => {
  const cents = fc.integer({ min: 1, max: 5_000_000 }).map((value) => (value / 100).toFixed(2));
  const kind = fc.constantFrom<DividendKind>("dividendo", "jcp", "rendimento");
  const day = fc
    .integer({ min: 1, max: 28 })
    .map((value) => `2026-03-${String(value).padStart(2, "0")}`);
  const line = fc.record({ kind, paidOn: day, gross: cents });

  it("JCP: voltar do líquido devolve o mesmo líquido, nas duas alíquotas", () => {
    fc.assert(
      fc.property(cents, fc.constantFrom("2025-06-10", "2026-06-10"), (gross, comDate) => {
        const payDate = comDate;
        const direct = proventoAmounts({
          assetClass: "acao",
          kind: "jcp",
          quantity: "1",
          ratePerShare: gross,
          comDate,
          payDate,
        });
        if ("skip" in direct) return;
        const net = toDbAmount(money(direct.gross).minus(direct.withheld));
        const rate = comDate < "2026" ? "0.15" : "0.175";
        const back = jcpFromNet(net, rate, payDate, comDate);
        expect(money(back.gross).minus(back.withheld).toFixed(2)).toBe(net);
      }),
    );
  });

  // Grava o que o plano manda e planeja de novo: é o que acontece ao reenviar o arquivo.
  const apply = (planned: ReturnType<typeof plan>, current: ExistingDividend[]) => [
    ...current,
    ...planned.filter(dividendSelectedByDefault).map((item): ExistingDividend => ({
      id: importedDividendId(String(item.line)),
      kind: item.kind,
      paidOn: item.paidOn,
      gross: item.amounts!.gross,
      withheld: item.amounts!.withheld,
      source: "familia",
      marketDividendId: null,
    })),
  ];

  it("mesmo arquivo duas vezes não acha nada novo", () => {
    fc.assert(
      fc.property(fc.array(line, { maxLength: 12 }), (lines) => {
        const rows = lines.map((item, index) =>
          row({ ...item, line: index + 1, net: null, kind: item.kind, withheld: "0.00" }),
        );
        const first = plan(rows);
        const dividends = apply(first, []);
        const second = plan(rows, [holding({ dividends })]);
        expect(second.filter(dividendSelectedByDefault)).toEqual([]);
      }),
    );
  });

  it("período sobreposto só acrescenta o que faltava", () => {
    fc.assert(
      fc.property(fc.array(line, { minLength: 1, maxLength: 10 }), fc.nat(9), (lines, cut) => {
        const rows = lines.map((item, index) =>
          row({ ...item, line: index + 1, net: null, withheld: "0.00" }),
        );
        const part = rows.slice(0, Math.min(cut, rows.length));
        const dividends = apply(plan(part), []);
        const whole = plan(rows, [holding({ dividends })]);
        const total = dividends.length + whole.filter(dividendSelectedByDefault).length;
        expect(total).toBeLessThanOrEqual(rows.length);
      }),
    );
  });

  it("linha importada nunca faz o Mercado criar o mesmo provento, e nunca tira os outros", () => {
    const trades: TradeInput[] = [
      { side: "compra", occurredOn: "2026-01-05", quantity: "100", unitPrice: "10", fees: "0" },
    ];
    const eventArb = fc.record({
      kind,
      payDate: day,
      ratePerShare: cents,
    });
    fc.assert(
      fc.property(
        fc.array(eventArb, { minLength: 1, maxLength: 6 }),
        fc.array(line, { maxLength: 6 }),
        (facts, lines) => {
          const events = facts.map((fact, index): MarketProvento => ({
            ...fact,
            id: `m${index}`,
            comDate: "2026-02-01",
          }));
          const rows = lines.map((item, index): ExistingDividend => ({
            ...item,
            id: importedDividendId(String(index)),
            withheld: "0.00",
            source: "familia",
            marketDividendId: null,
          }));
          const { create, skippedFamily } = reconcileProventos({
            assetClass: "fii",
            trades,
            events,
            existing: rows,
            blocked: new Set(),
          });
          // Cada linha importada tira no máximo um provento do que seria criado.
          expect(skippedFamily).toBeLessThanOrEqual(rows.length);
          for (const entry of create) {
            const free = rows.filter(
              (item) =>
                sameProventoKind(item.kind, entry.kind) &&
                daysApart(item.paidOn, entry.paidOn) <= 5,
            );
            const taken = events.filter(
              (event) =>
                !create.some((made) => made.marketDividendId === event.id) &&
                sameProventoKind(event.kind, entry.kind) &&
                daysApart(event.payDate, entry.paidOn) <= 10,
            );
            // Criado apesar de ter linha por perto só se a linha já responde por outro.
            expect(free.length).toBeLessThanOrEqual(taken.length);
          }
        },
      ),
    );
  });
});
