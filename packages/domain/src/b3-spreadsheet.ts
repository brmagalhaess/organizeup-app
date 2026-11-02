// Excel da Área do Investidor da B3 (ADR-0024). Puro: recebe as abas já lidas e devolve operações.
//
// Fontes do formato, conferidas em 2026-11-01. Não há arquivo real neste repositório:
// - Negociação e Movimentação: colunas de `crates/providers/src/b3_extrato.rs` (github.com/4nier-app/patrimonio).
//   A primeira aba traz os dados; o nome dela não é usado.
// - Data da Movimentação: "Transferência - Liquidação" é a compra ou venda, com a data de liquidação, D+2
//   úteis (github.com/mcsscalabrin/i10-cli), e guarda só o consolidado (github.com/edirpedro/investimentos.js).
// - Posição: sem fonte pública com as colunas. A lista abaixo vem de relatos de quem usa o arquivo e é a
//   que mais precisa de conferência com um arquivo real.
import { normalizeDescription } from "./statement";
import {
  cleanFileText,
  dateOf,
  decimalOf,
  decimalText,
  INVESTMENT_FILE_MAX_LINES,
  InvestmentFileError,
  type IgnoredLine,
  type IgnoreReason,
  type InvestmentFileKind,
  type ParsedInvestmentFile,
  type ParsedPosition,
  type ParsedTrade,
} from "./investment-file";
import { normalizeTicker } from "./market";
import { money, toDbAmount, type MoneyValue } from "./money";

export type SheetCell = string | number | boolean | Date | null | undefined;

export interface WorkbookSheet {
  name: string;
  rows: SheetCell[][];
}

type Columns<K extends string> = Record<K, number>;

interface Layout<R extends string, O extends string> {
  required: Record<R, string[]>;
  optional: Record<O, string[]>;
}

const TICKER_NAMES = ["codigo de negociacao", "codigo negociacao", "codigo do ativo"];
const QUANTITY_NAMES = ["quantidade"];

const NEGOCIACAO = {
  required: {
    date: ["data do negocio", "data negocio", "data da negociacao"],
    side: ["tipo de movimentacao", "tipo de operacao", "compra venda"],
    ticker: TICKER_NAMES,
    quantity: QUANTITY_NAMES,
    price: ["preco", "preco unitario"],
  },
  optional: { market: ["mercado"], value: ["valor", "valor da operacao"] },
} satisfies Layout<string, string>;

const MOVIMENTACAO = {
  required: {
    flow: ["entrada saida"],
    date: ["data"],
    type: ["movimentacao"],
    product: ["produto"],
    quantity: QUANTITY_NAMES,
    price: ["preco unitario"],
    value: ["valor da operacao"],
  },
  optional: {},
} satisfies Layout<string, string>;

const POSICAO = {
  required: { ticker: TICKER_NAMES, quantity: QUANTITY_NAMES },
  optional: {
    product: ["produto"],
    close: ["preco de fechamento"],
    value: ["valor atualizado"],
    available: ["quantidade disponivel"],
  },
} satisfies Layout<string, string>;

const HEADER_SEARCH_ROWS = 15;
/** Diferença aceita entre quantidade × preço e o valor da linha: arredondamento da B3. */
const LINE_TOLERANCE = "0.02";
/** A Movimentação traz preço médio arredondado do que foi consolidado no dia. */
const CONSOLIDATED_TOLERANCE = "0.005";

const headerOf = (cell: SheetCell) => (typeof cell === "string" ? normalizeDescription(cell) : "");

function columnsIn<R extends string, O extends string>(
  row: SheetCell[],
  layout: Layout<R, O>,
): (Columns<R> & Partial<Columns<O>>) | null {
  const names = row.map(headerOf);
  const find = (aliases: string[]) => names.findIndex((name) => aliases.includes(name));
  const found: Record<string, number> = {};
  for (const [key, aliases] of Object.entries<string[]>(layout.required)) {
    const column = find(aliases);
    if (column < 0) return null;
    found[key] = column;
  }
  for (const [key, aliases] of Object.entries<string[]>(layout.optional)) {
    const column = find(aliases);
    if (column >= 0) found[key] = column;
  }
  return found as Columns<R> & Partial<Columns<O>>;
}

/** Procura o cabeçalho nas primeiras linhas, qualquer que seja a ordem das colunas. */
function locate<R extends string, O extends string>(rows: SheetCell[][], layout: Layout<R, O>) {
  for (let index = 0; index < Math.min(HEADER_SEARCH_ROWS, rows.length); index += 1) {
    const columns = columnsIn(rows[index]!, layout);
    if (columns) return { header: index, columns };
  }
  return null;
}

const isBlank = (cell: SheetCell) =>
  cell === null || cell === undefined || (typeof cell === "string" && cell.trim() === "");
const blankRow = (row: SheetCell[]) => row.every(isBlank);

const FOOTER_MAX_CELLS = 3;

/** Rodapé com soma: começa em "Total" e quase não tem células. Um fundo chamado Total passa. */
function isFooter(row: SheetCell[]): boolean {
  const filled = row.filter((cell) => !isBlank(cell));
  const [first] = filled;
  return (
    filled.length <= FOOTER_MAX_CELLS && typeof first === "string" && /^total\b/i.test(first.trim())
  );
}

const positive = (cell: SheetCell): MoneyValue | null => {
  const value = decimalOf(cell);
  return value && value.gt(0) ? value : null;
};

interface TradeFields {
  side: ParsedTrade["side"];
  date: SheetCell;
  ticker: string;
  quantity: SheetCell;
  price: SheetCell;
  value: SheetCell;
}

type TradeResult = { trade: Omit<ParsedTrade, "line"> } | { reason: IgnoreReason };

function tradeFrom(fields: TradeFields, consolidated: boolean): TradeResult {
  const date = dateOf(fields.date);
  const quantity = positive(fields.quantity);
  const price = positive(fields.price);
  if (!date || !quantity || !price) return { reason: "dados_invalidos" };
  const value = positive(fields.value);
  if (value) {
    const gap = quantity.times(price).minus(value).abs();
    const limit = consolidated ? value.times(CONSOLIDATED_TOLERANCE) : money(LINE_TOLERANCE);
    if (gap.gt(limit)) return { reason: "valores_nao_fecham" };
  }
  // No consolidado, o valor é mais exato que o preço médio arredondado.
  const unitPrice = consolidated && value ? value.dividedBy(quantity) : price;
  return {
    trade: {
      ticker: fields.ticker,
      title: null,
      side: fields.side,
      date,
      quantity: decimalText(quantity),
      unitPrice: decimalText(unitPrice),
      fees: toDbAmount(0),
      doubt: null,
    },
  };
}

interface Collected {
  trades: ParsedTrade[];
  positions: ParsedPosition[];
  ignored: IgnoredLine[];
}

const emptyCollected = (): Collected => ({ trades: [], positions: [], ignored: [] });

function parseNegociacao(rows: SheetCell[][], found: NonNullable<ReturnType<typeof locateNeg>>) {
  const { header, columns } = found;
  const out = emptyCollected();
  rows.slice(header + 1).forEach((row, offset) => {
    if (blankRow(row) || isFooter(row)) return;
    const line = header + offset + 2;
    const code = cleanFileText(row[columns.ticker], 20);
    const date = dateOf(row[columns.date]);
    const skip = (reason: IgnoreReason) =>
      out.ignored.push({ line, label: code || "—", date, reason });
    const side = normalizeDescription(String(row[columns.side] ?? ""));
    if (side !== "compra" && side !== "venda") return void skip("outra_movimentacao");
    const market =
      columns.market === undefined ? "" : normalizeDescription(String(row[columns.market] ?? ""));
    if (market && !market.includes("vista") && !market.includes("fracion"))
      return void skip("mercado_nao_suportado");
    const ticker = normalizeTicker(code);
    if (!ticker) return void skip("ativo_nao_listado");
    const result = tradeFrom(
      {
        side,
        date: row[columns.date],
        ticker,
        quantity: row[columns.quantity],
        price: row[columns.price],
        value: columns.value === undefined ? null : row[columns.value],
      },
      false,
    );
    if ("reason" in result) return void skip(result.reason);
    out.trades.push({ line, ...result.trade });
  });
  return out;
}

const locateNeg = (rows: SheetCell[][]) => locate(rows, NEGOCIACAO);
const locateMov = (rows: SheetCell[][]) => locate(rows, MOVIMENTACAO);
const locatePos = (rows: SheetCell[][]) => locate(rows, POSICAO);

const TRADE_MOVEMENT = "transferencia liquidacao";
const EARNINGS = /^(rendimento|dividendo|juros sobre capital|reembolso)/;
const CORPORATE =
  /^(desdobro|grupamento|bonificacao|amortizacao|atualizacao|incorporacao|cisao|fracao|leilao|direito|direitos|cessao|recibo|subscricao|resgate|vencimento|conversao|troca)/;

/** Só "Transferência - Liquidação" é compra ou venda. "Transferência" sozinha é troca de corretora. */
function movementReason(type: string): IgnoreReason | null {
  if (type === TRADE_MOVEMENT) return null;
  if (EARNINGS.test(type)) return "provento";
  if (CORPORATE.test(type)) return "evento";
  if (type.startsWith("transferencia")) return "transferencia";
  return "outra_movimentacao";
}

const WEEKDAYS_TO_SETTLE = 2;

/** Data do negócio a partir da liquidação: D-2 úteis, sem contar feriado. */
export function tradeDateOfSettlement(settledOn: string): string {
  const date = new Date(`${settledOn}T00:00:00Z`);
  let left = WEEKDAYS_TO_SETTLE;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() - 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return date.toISOString().slice(0, 10);
}

/** "ABCD3 - ABCD SA" vira o código e o nome. */
function splitProduct(cell: SheetCell) {
  const text = cleanFileText(cell, 120);
  const [code = "", ...rest] = text.split(" - ");
  return { text, code: code.trim(), name: rest.join(" - ").trim() || null };
}

function parseMovimentacao(rows: SheetCell[][], found: NonNullable<ReturnType<typeof locateMov>>) {
  const { header, columns } = found;
  const out = emptyCollected();
  rows.slice(header + 1).forEach((row, offset) => {
    if (blankRow(row) || isFooter(row)) return;
    const line = header + offset + 2;
    const product = splitProduct(row[columns.product]);
    const settled = dateOf(row[columns.date]);
    const skip = (reason: IgnoreReason) =>
      out.ignored.push({ line, label: product.text || "—", date: settled, reason });
    const type = normalizeDescription(String(row[columns.type] ?? ""));
    const reason = movementReason(type);
    if (reason) return void skip(reason);
    const flow = normalizeDescription(String(row[columns.flow] ?? ""));
    if (flow !== "credito" && flow !== "debito") return void skip("dados_invalidos");
    const ticker = normalizeTicker(product.code);
    if (!ticker) return void skip("ativo_nao_listado");
    if (!settled) return void skip("dados_invalidos");
    const result = tradeFrom(
      {
        side: flow === "credito" ? "compra" : "venda",
        date: tradeDateOfSettlement(settled),
        ticker,
        quantity: row[columns.quantity],
        price: row[columns.price],
        value: row[columns.value],
      },
      true,
    );
    if ("reason" in result) return void skip(result.reason);
    out.trades.push({ line, ...result.trade });
  });
  return out;
}

/** Cada aba com "Produto" fala de um tipo de ativo; as sem código são renda fixa e fundos. */
function parsePosicao(sheets: WorkbookSheet[]) {
  const out = emptyCollected();
  const byTicker = new Map<string, ParsedPosition>();
  let lineBase = 0;
  for (const sheet of sheets) {
    const base = lineBase;
    lineBase += sheet.rows.length + 1;
    const found = locatePos(sheet.rows);
    if (!found) {
      const productHeader = sheet.rows
        .slice(0, HEADER_SEARCH_ROWS)
        .findIndex((row) => row.some((cell) => headerOf(cell) === "produto"));
      if (productHeader < 0) continue;
      const column = sheet.rows[productHeader]!.findIndex((cell) => headerOf(cell) === "produto");
      sheet.rows.slice(productHeader + 1).forEach((row, offset) => {
        if (blankRow(row) || isFooter(row)) return;
        out.ignored.push({
          line: base + productHeader + offset + 2,
          label: cleanFileText(row[column]) || sheet.name,
          date: null,
          reason: "ativo_nao_listado",
        });
      });
      continue;
    }
    const { header, columns } = found;
    sheet.rows.slice(header + 1).forEach((row, offset) => {
      if (blankRow(row) || isFooter(row)) return;
      const line = base + header + offset + 2;
      const code = cleanFileText(row[columns.ticker], 20);
      const product = columns.product === undefined ? null : row[columns.product];
      const ticker = normalizeTicker(code);
      const label = code || cleanFileText(product) || "—";
      if (!ticker) {
        out.ignored.push({ line, label, date: null, reason: "ativo_nao_listado" });
        return;
      }
      const quantity = positive(row[columns.quantity]);
      if (!quantity) {
        out.ignored.push({ line, label, date: null, reason: "dados_invalidos" });
        return;
      }
      const close = columns.close === undefined ? null : positive(row[columns.close]);
      // A mesma ação em duas corretoras vem em duas linhas.
      const known = byTicker.get(ticker);
      byTicker.set(ticker, {
        line: known?.line ?? line,
        ticker,
        name: known?.name ?? (splitProduct(product).name || null),
        quantity: decimalText(money(known?.quantity ?? 0).plus(quantity)),
        closePrice: close ? decimalText(close) : (known?.closePrice ?? null),
      });
    });
  }
  out.positions = [...byTicker.values()];
  return out;
}

/**
 * Reconhece o arquivo pelas colunas. Layout que não bate com nenhum dos três é recusado inteiro: melhor
 * mensagem clara que operação errada na carteira.
 */
export function parseB3Workbook(sheets: WorkbookSheet[]): ParsedInvestmentFile {
  let kind: InvestmentFileKind | null = null;
  let result: Collected | null = null;
  for (const sheet of sheets) {
    const negociacao = locateNeg(sheet.rows);
    if (negociacao) {
      kind = "negociacao";
      result = parseNegociacao(sheet.rows, negociacao);
      break;
    }
    const movimentacao = locateMov(sheet.rows);
    if (movimentacao) {
      kind = "movimentacao";
      result = parseMovimentacao(sheet.rows, movimentacao);
      break;
    }
  }
  if (!result && sheets.some((sheet) => looksLikePosition(sheet.rows))) {
    kind = "posicao";
    result = parsePosicao(sheets);
  }
  if (!kind || !result) throw new InvestmentFileError("layout");
  const total = result.trades.length + result.positions.length + result.ignored.length;
  if (total === 0) throw new InvestmentFileError("sem_linhas");
  if (total > INVESTMENT_FILE_MAX_LINES) throw new InvestmentFileError("muitas_linhas");
  return { kind, ...result };
}

/** Código e quantidade não bastam: Negociação com coluna renomeada não pode passar por Posição. */
function looksLikePosition(rows: SheetCell[][]): boolean {
  const found = locatePos(rows);
  if (!found) return false;
  const { close, value, available } = found.columns;
  return close !== undefined || value !== undefined || available !== undefined;
}
