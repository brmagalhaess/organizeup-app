// Arquivos de proventos (ADR-0029): Excel da Área do Investidor da B3 e CSV genérico. Puro: recebe as abas já
// lidas ou o texto e devolve linhas. O que sai em `rows` vai ao servidor, então só carrega código, tipo, data e
// valores. Nome, CPF e instituição ficam de fora, e o rótulo de `ignored` não sai do navegador.
//
// Fontes das colunas, em 2026-11-02, sem arquivo real neste repositório (lista completa no ADR-0029):
// - Proventos recebidos: `backend/app/services/extrato_b3.py` (github.com/Cristianosm91/Controle_Investimentos),
//   com o valor já líquido. Central de ajuda da Warren lista as mesmas colunas e diz que vem separado por mês.
// - Movimentação: as mesmas colunas de `b3-spreadsheet.ts`. Tipos de `src/importers/movimentacao_excel.rs`
//   (github.com/kov/interest). "- Transferido" repete outro lançamento, e JCP vem líquido:
//   `crates/providers/src/b3_extrato.rs` (github.com/4nier-app/patrimonio).
import {
  blankRow,
  isFooter,
  locateLayout,
  splitProduct,
  type Layout,
  type SheetCell,
  type WorkbookSheet,
} from "./b3-spreadsheet";
import {
  checkInvestmentFile,
  cleanFileText,
  dateOf,
  decimalOf,
  INVESTMENT_FILE_MAX_BYTES,
  INVESTMENT_FILE_MAX_LINES,
  InvestmentFileError,
} from "./investment-file";
import { normalizeTicker, type DividendKind } from "./market";
import { money, toDbAmount } from "./money";
import { normalizeDescription, parseCsvTable, parseStatementDate } from "./statement";

export const DIVIDEND_FILE_ACCEPT = ".xlsx,.csv";

export const DIVIDEND_FILE_ERRORS = [
  "vazio",
  "tamanho",
  "tipo",
  "xls_antigo",
  "layout",
  "sem_linhas",
  "muitas_linhas",
  "colunas",
] as const;
export type DividendFileErrorCode = (typeof DIVIDEND_FILE_ERRORS)[number];

/** O código vira a mensagem na tela. Não leva nada do conteúdo do arquivo. */
export class DividendFileError extends Error {
  constructor(readonly code: DividendFileErrorCode) {
    super(code);
    this.name = "DividendFileError";
  }
}

const isErrorCode = (code: string): code is DividendFileErrorCode =>
  (DIVIDEND_FILE_ERRORS as readonly string[]).includes(code);

const startsLikeBinary = (bytes: Uint8Array) =>
  bytes.includes(0) ||
  (bytes[0] === 0x50 && bytes[1] === 0x4b) ||
  (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);

/** Tamanho, tipo pelo conteúdo e proteção contra zip bomb, antes de abrir o arquivo. */
export function checkDividendFile(bytes: Uint8Array, name: string): "csv" | "xlsx" {
  if (/\.(csv|txt)$/i.test(name.trim())) {
    if (bytes.length === 0) throw new DividendFileError("vazio");
    if (bytes.length > INVESTMENT_FILE_MAX_BYTES) throw new DividendFileError("tamanho");
    if (startsLikeBinary(bytes)) throw new DividendFileError("tipo");
    return "csv";
  }
  try {
    if (checkInvestmentFile(bytes, name) === "xlsx") return "xlsx";
  } catch (error) {
    if (error instanceof InvestmentFileError && isErrorCode(error.code)) {
      throw new DividendFileError(error.code);
    }
    throw error;
  }
  throw new DividendFileError("tipo");
}

export type DividendFileKind = "recebidos" | "movimentacao" | "csv";

export interface ParsedDividend {
  /** Linha no arquivo: identifica o provento entre a prévia e a confirmação. */
  line: number;
  ticker: string;
  kind: DividendKind;
  paidOn: string;
  /** Null quando o arquivo não traz; o plano decide o que dá para calcular. */
  gross: string | null;
  withheld: string | null;
  net: string | null;
}

export const DIVIDEND_IGNORE_REASONS = [
  "transferido",
  "reembolso",
  "debito",
  "outra_movimentacao",
  "tipo_desconhecido",
  "ativo_nao_listado",
  "dados_invalidos",
  "valores_nao_fecham",
  "data_futura",
] as const;
export type DividendIgnoreReason = (typeof DIVIDEND_IGNORE_REASONS)[number];

export interface IgnoredDividendLine {
  line: number;
  label: string;
  date: string | null;
  reason: DividendIgnoreReason;
}

export interface ParsedDividendFile {
  kind: DividendFileKind;
  rows: ParsedDividend[];
  ignored: IgnoredDividendLine[];
}

const RECEBIDOS = {
  required: {
    product: ["produto"],
    date: ["pagamento", "data de pagamento", "data do pagamento"],
    type: ["tipo de evento"],
    net: ["valor liquido"],
  },
  optional: {},
} satisfies Layout<string, string>;

const MOVIMENTACAO = {
  required: {
    flow: ["entrada saida"],
    date: ["data"],
    type: ["movimentacao"],
    product: ["produto"],
    net: ["valor da operacao"],
  },
  optional: {},
} satisfies Layout<string, string>;

/** Texto do tipo, normalizado, para a tabela de proventos. O que não está aqui a tabela não aceita. */
function kindOf(type: string): DividendKind | null {
  if (/^(dividendos?|dividends?|div)\b/.test(type)) return "dividendo";
  if (/^(jcp|jscp|juros sobre capital|juros s capital|juros s c\b|interest on)/.test(type)) {
    return "jcp";
  }
  if (/^rendimento/.test(type)) return "rendimento";
  return null;
}

/** Tudo em centavos. Zero, negativo ou texto: null. */
function centsOf(cell: SheetCell): string | null {
  const value = decimalOf(cell);
  if (!value || value.lte(0) || value.gte("1000000000000")) return null;
  const cents = toDbAmount(value);
  return money(cents).gt(0) ? cents : null;
}

const ONE_CENT = "0.01";

type Amounts = Pick<ParsedDividend, "gross" | "withheld" | "net">;

/** Bruto, retido e líquido que vieram juntos precisam fechar: um centavo por arredondamento. */
function amountsClose({ gross, withheld, net }: Amounts): boolean {
  if (gross === null) return true;
  const paidOut = money(withheld ?? 0).plus(net ?? 0);
  if (money(withheld ?? 0).gt(gross)) return false;
  if (net === null) return true;
  if (money(net).gt(gross)) return false;
  return withheld === null || paidOut.minus(gross).abs().lte(ONE_CENT);
}

interface Collector extends Omit<ParsedDividendFile, "kind"> {
  add(fields: {
    line: number;
    product: { label: string; ticker: string | null };
    kind: DividendKind | null;
    reason: DividendIgnoreReason | null;
    date: SheetCell;
    amounts: Amounts;
  }): void;
}

function collector(): Collector {
  const rows: ParsedDividend[] = [];
  const ignored: IgnoredDividendLine[] = [];
  return {
    rows,
    ignored,
    add({ line, product, kind, reason, date, amounts }) {
      const paidOn = dateOf(date);
      const skip = (why: DividendIgnoreReason) =>
        void ignored.push({ line, label: product.label || "—", date: paidOn, reason: why });
      if (reason) return skip(reason);
      if (!kind) return skip("tipo_desconhecido");
      if (!product.ticker) return skip("ativo_nao_listado");
      if (!paidOn || (amounts.gross === null && amounts.net === null)) {
        return skip("dados_invalidos");
      }
      if (!amountsClose(amounts)) return skip("valores_nao_fecham");
      rows.push({ line, ticker: product.ticker, kind, paidOn, ...amounts });
    },
  };
}

const productOf = (cell: SheetCell) => {
  const { text, code } = splitProduct(cell);
  return { label: text, ticker: normalizeTicker(code) };
};

/** Linha de mês, título solto e cabeçalho repetido não são dado nem motivo de aviso. */
function noise(row: SheetCell[], header: SheetCell[]): boolean {
  const filled = row.filter((cell) => cell !== null && cell !== undefined && cell !== "");
  if (blankRow(row) || isFooter(row) || filled.length < 2) return true;
  return row.every((cell, column) => cell === header[column]);
}

const textOf = (cell: SheetCell) => normalizeDescription(String(cell ?? ""));

function movementReason(type: string): DividendIgnoreReason | null {
  if (type.endsWith("transferido")) return "transferido";
  if (type.startsWith("reembolso")) return "reembolso";
  return kindOf(type) ? null : "outra_movimentacao";
}

type Found = "recebidos" | "movimentacao";

function parseSheet(sheet: WorkbookSheet, base: number, out: Collector): Found | null {
  const { rows } = sheet;
  const recebidos = locateLayout(rows, RECEBIDOS);
  const movimentacao = recebidos ? null : locateLayout(rows, MOVIMENTACAO);
  const header = recebidos?.header ?? movimentacao?.header;
  if (header === undefined) return null;
  const columns = recebidos?.columns ?? movimentacao!.columns;
  rows.slice(header + 1).forEach((row, offset) => {
    if (noise(row, rows[header]!)) return;
    const type = textOf(row[columns.type]);
    const flow = movimentacao ? textOf(row[movimentacao.columns.flow]) : "credito";
    const typeReason = movimentacao
      ? movementReason(type)
      : type.startsWith("reembolso")
        ? "reembolso"
        : null;
    out.add({
      line: base + header + offset + 2,
      product: productOf(row[columns.product]),
      kind: kindOf(type),
      reason: typeReason ?? (flow === "credito" ? null : "debito"),
      date: row[columns.date],
      amounts: { gross: null, withheld: null, net: centsOf(row[columns.net]) },
    });
  });
  return recebidos ? "recebidos" : "movimentacao";
}

function parseWorkbook(sheets: WorkbookSheet[]): ParsedDividendFile {
  const out = collector();
  let kind: Found | null = null;
  let base = 0;
  for (const sheet of sheets) {
    const found = parseSheet(sheet, base, out);
    kind ??= found;
    base += sheet.rows.length + 1;
  }
  if (!kind) throw new DividendFileError("layout");
  return { kind, rows: out.rows, ignored: out.ignored };
}

/** Índice de cada campo no CSV, -1 quando não há. `value` é coluna só de "Valor", tratada como líquido. */
export interface DividendColumns {
  header: number;
  date: number;
  asset: number;
  kind: number;
  gross: number;
  withheld: number;
  net: number;
  value: number;
}

const NAME_RULES: Record<Exclude<keyof DividendColumns, "header">, (name: string) => boolean> = {
  date: (n) =>
    n.includes("pagamento") || n === "data" || n === "date" || n === "payment date" || n === "dt",
  asset: (n) =>
    [
      "ativo",
      "codigo",
      "codigo de negociacao",
      "codigo do ativo",
      "ticker",
      "papel",
      "produto",
      "asset",
      "symbol",
    ].includes(n),
  kind: (n) =>
    [
      "tipo",
      "tipo de evento",
      "tipo de provento",
      "tipo do provento",
      "evento",
      "provento",
      "kind",
      "type",
    ].includes(n),
  gross: (n) => n.includes("bruto") || n === "gross",
  withheld: (n) =>
    n === "ir" ||
    n.startsWith("ir ") ||
    n.startsWith("irrf") ||
    n.includes("retid") ||
    n.includes("imposto") ||
    n === "tax" ||
    n === "withheld",
  net: (n) => n.includes("liquido") || n === "net" || n.includes("recebido"),
  value: (n) => ["valor", "valor total", "amount", "value", "total"].includes(n),
};

const FIELDS = Object.keys(NAME_RULES) as Array<keyof typeof NAME_RULES>;

const HEADER_SEARCH_ROWS = 15;

function columnsAt(row: string[], header: number): DividendColumns {
  const names = row.map(normalizeDescription);
  const columns = { header } as DividendColumns;
  for (const field of FIELDS) columns[field] = names.findIndex(NAME_RULES[field]);
  return columns;
}

export const columnsComplete = (columns: DividendColumns) =>
  columns.date >= 0 &&
  columns.asset >= 0 &&
  columns.kind >= 0 &&
  (columns.gross >= 0 || columns.net >= 0 || columns.value >= 0);

/**
 * A linha com mais títulos conhecidos, a primeira no empate. Sem nenhum, a primeira com várias colunas. Linha com
 * data é dado, não título: sem esse cuidado, a primeira linha de um CSV sem títulos sumiria sem aviso.
 */
export function dividendCsvColumns(table: string[][]): DividendColumns {
  const known = (columns: DividendColumns) =>
    FIELDS.filter((field) => columns[field] >= 0).length + (columnsComplete(columns) ? 10 : 0);
  const candidates = table
    .slice(0, HEADER_SEARCH_ROWS)
    .map((row, index) => columnsAt(row, index))
    .filter((columns) => {
      const row = table[columns.header]!;
      return row.length > 1 && !row.some((cell) => parseStatementDate(cell) !== null);
    });
  const best = candidates.reduce<DividendColumns | null>(
    (top, columns) => (top && known(top) >= known(columns) ? top : columns),
    null,
  );
  return best ?? columnsAt([], -1);
}

function parseCsv(table: string[][], columns: DividendColumns): ParsedDividendFile {
  if (!columnsComplete(columns)) throw new DividendFileError("colunas");
  const out = collector();
  const at = (row: string[], column: number) => (column >= 0 ? (row[column] ?? "") : "");
  table.slice(columns.header + 1).forEach((row, offset) => {
    if (row.every((cell) => !cell.trim())) return;
    const type = normalizeDescription(at(row, columns.kind));
    const asset = cleanFileText(at(row, columns.asset));
    out.add({
      line: columns.header + offset + 2,
      product: { label: asset, ticker: normalizeTicker(splitProduct(asset).code) },
      kind: kindOf(type),
      reason: type.endsWith("transferido") ? "transferido" : null,
      date: at(row, columns.date),
      amounts: {
        gross: centsOf(at(row, columns.gross)),
        withheld: taxOf(at(row, columns.withheld)),
        net: centsOf(at(row, columns.net)) ?? centsOf(at(row, columns.value)),
      },
    });
  });
  return { kind: "csv", rows: out.rows, ignored: out.ignored };
}

/** Coluna de imposto aceita zero: "0,00" é informação, vazio não. */
function taxOf(cell: string): string | null {
  const value = decimalOf(cell);
  if (!cell.trim() || !value || value.lt(0)) return null;
  return toDbAmount(value);
}

export type DividendFileInput =
  | { format: "xlsx"; sheets: WorkbookSheet[] }
  | { format: "csv"; text: string; columns?: DividendColumns };

/**
 * Lê o arquivo. Layout de Excel que não bate é recusado inteiro. CSV sem as colunas lança `colunas`: quem chama
 * pode mostrar `dividendCsvColumns` para a pessoa escolher e chamar de novo com `columns`.
 */
export function parseDividendFile(input: DividendFileInput): ParsedDividendFile {
  let parsed: ParsedDividendFile;
  if (input.format === "xlsx") {
    parsed = parseWorkbook(input.sheets);
  } else {
    const table = parseCsvTable(input.text);
    if (table.length === 0) throw new DividendFileError("vazio");
    parsed = parseCsv(table, input.columns ?? dividendCsvColumns(table));
  }
  const total = parsed.rows.length + parsed.ignored.length;
  if (total === 0) throw new DividendFileError("sem_linhas");
  if (total > INVESTMENT_FILE_MAX_LINES) throw new DividendFileError("muitas_linhas");
  return parsed;
}
