// Nota de corretagem em PDF, padrão SINACOR (ADR-0024). Puro: recebe as linhas de texto do PDF.
//
// Fontes do layout, conferidas em 2026-11-01. Não há nota real neste repositório:
// - Rótulos das seções e taxas: `correpy/parsers/brokerage_notes/b3_parser/b3_parser.py`
//   (github.com/thiagosalvatore/correpy): "Nr. nota", "Data pregão", "Negócios realizados",
//   "Resumo dos Negócios", "Resumo Financeiro", "Líquido para" e as taxas.
// - Linha de negócio: gist.github.com/reisjr/cc9816d1ad4d51c5ae36440b7e41f602: praça, C/V, tipo de mercado,
//   especificação, observação, quantidade, preço, valor e D/C.
//
// A nota traz nome, CPF, endereço e conta. Este código lê só o número da nota, a data, as linhas de negócio
// e as taxas; todo o resto é descartado aqui, e o texto do PDF não sai do navegador.
import Decimal from "decimal.js";
import {
  cleanFileText,
  decimalText,
  INVESTMENT_FILE_MAX_LINES,
  InvestmentFileError,
  type IgnoredLine,
  type IgnoreReason,
  type ParsedInvestmentFile,
  type ParsedTrade,
} from "./investment-file";
import { normalizeTicker } from "./market";
import { money, toCents, toDbAmount, type MoneyValue } from "./money";
import { parseStatementAmount, parseStatementDate } from "./statement";

/** Maiúsculas e sem acento: os rótulos mudam de grafia entre corretoras. */
const plainText = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toUpperCase();

const AMOUNT = String.raw`(\d[\d.]*,\d{2})`;
const VALUE_AFTER_LABEL = String.raw`(?:\s*\([^)]*\))?\s*[:.]?\s*${AMOUNT}(?:\s*([DC])\b)?`;

const feePattern = (label: string) => new RegExp(String.raw`\b${label}${VALUE_AFTER_LABEL}`);

/** Custos que entram no preço médio. IRRF fica de fora: é imposto antecipado, não custo. */
const FEES = [
  feePattern(String.raw`TAXA DE LIQUIDACAO`),
  feePattern(String.raw`TAXA DE REGISTRO`),
  feePattern(String.raw`TAXA DE TERMO\s*/\s*OPCOES`),
  feePattern(String.raw`TAXA A\.?\s?N\.?\s?A\.?`),
  feePattern(String.raw`EMOLUMENTOS`),
  feePattern(String.raw`TAXA OPERACIONAL`),
  feePattern(String.raw`CORRETAGEM`),
  feePattern(String.raw`EXECUCAO(?: CASA)?`),
  feePattern(String.raw`TAXA DE CUSTODIA`),
  feePattern(String.raw`IMPOSTOS`),
  feePattern(String.raw`I\.?S\.?S\.?`),
  feePattern(String.raw`OUTROS`),
];
const IRRF = new RegExp(
  String.raw`\bI\.?R\.?R\.?F\.?[^\d]*?(?:BASE\s*(?:R\$)?\s*[\d.,]+\s+)?${AMOUNT}`,
);
const NET = new RegExp(String.raw`\bLIQUIDO PARA\s*\d{2}/\d{2}/\d{4}\s*${AMOUNT}(?:\s*([DC])\b)?`);
const NOTE_NUMBER = /\bNR\.?\s*(?:DA\s*)?NOTA\b/;
const NOTE_FIELDS = /(?:^|\D)(\d[\d.]*)\b[\s\S]*?(\d{2}\/\d{2}\/\d{4})/;
const TRADES_START = /\bNEGOCIOS REALIZADOS\b/;
const TRADES_END = /\bRESUMO DOS NEGOCIOS\b/;
const TRADE_LINE = new RegExp(
  String.raw`^(?:.*?\s)?([CV])\s+(.+?)\s+(\d[\d.]*)\s+(\d[\d.]*,\d{2,8})\s+${AMOUNT}\s*([DC])?$`,
);
const SUPPORTED_MARKET = /^(VISTA|FRACIONARIO)\b\s*(.*)$/;
const TICKER_IN_TITLE = /\b[A-Z]{4}\d{1,2}F?\b/;
const OBSERVATION = /^(?:#\S*|[A-Z0-9]|\*+)$/;

/** Até 3 linhas depois do rótulo: o número e a data ficam na linha de baixo em boa parte das notas. */
const HEADER_LOOKAHEAD = 3;
const NET_TOLERANCE = "0.02";
const LINE_TOLERANCE = "0.02";

interface NoteLine {
  line: number;
  title: string;
  side: ParsedTrade["side"];
  quantity: MoneyValue;
  price: MoneyValue;
  gross: MoneyValue;
  /** Linha lida, mas fora do que a carteira guarda. */
  reason: IgnoreReason | null;
}

interface Note {
  date: string;
  lines: NoteLine[];
  unread: IgnoredLine[];
  fees: Map<number, MoneyValue>;
  irrf: MoneyValue;
  /** Positivo: a pessoa paga. */
  net: MoneyValue | null;
}

const amountOf = (text: string) => parseStatementAmount(text) ?? money(0);

/** Tira a coluna de observação (`#`, `D` de day trade, `F` de cobertura) do fim do título. */
function titleOf(market: string): string {
  const tokens = market.split(" ");
  while (tokens.length > 1 && OBSERVATION.test(tokens.at(-1)!)) tokens.pop();
  return cleanFileText(tokens.join(" "));
}

function readTradeLine(text: string, line: number): NoteLine | null {
  const match = TRADE_LINE.exec(text);
  if (!match) return null;
  const [, sideCode, description, rawQuantity, rawPrice, rawGross, flag] = match;
  const side = sideCode === "C" ? "compra" : "venda";
  const quantity = amountOf(rawQuantity!);
  const price = amountOf(rawPrice!);
  const gross = amountOf(rawGross!);
  const market = SUPPORTED_MARKET.exec(description!);
  const title = titleOf(market ? market[2]! : description!);
  let reason: IgnoreReason | null = market ? null : "mercado_nao_suportado";
  const flagOk = !flag || (side === "compra" ? flag === "D" : flag === "C");
  if (!reason && (quantity.isZero() || price.isZero())) reason = "dados_invalidos";
  if (!reason && (!flagOk || quantity.times(price).minus(gross).abs().gt(LINE_TOLERANCE)))
    reason = "valores_nao_fecham";
  return { line, title, side, quantity, price, gross, reason };
}

/**
 * Divide o total em centavos pelo peso de cada linha. A soma fecha com o total: os centavos que sobram do
 * arredondamento vão para as maiores frações.
 */
export function shareFees(total: string, weights: string[]): string[] {
  const cents = toCents(total).times(100);
  const sum = weights.reduce((acc, weight) => acc.plus(weight), money(0));
  if (weights.length === 0) return [];
  if (sum.isZero() || cents.lte(0)) return weights.map(() => toDbAmount(0));
  const exact = weights.map((weight) => cents.times(weight).dividedBy(sum));
  const floors = exact.map((value) => value.toDecimalPlaces(0, Decimal.ROUND_DOWN));
  let left = cents.minus(floors.reduce((acc, value) => acc.plus(value), money(0))).toNumber();
  const order = exact
    .map((value, index) => ({ index, rest: value.minus(floors[index]!) }))
    .sort((a, b) => b.rest.comparedTo(a.rest) || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index] = floors[index]!.plus(1);
    left -= 1;
  }
  return floors.map((value) => toDbAmount(value.dividedBy(100)));
}

/** Soma das taxas com sinal: "C" devolve. */
function feesTotal(note: Note): MoneyValue {
  return [...note.fees.values()].reduce((acc, value) => acc.plus(value), money(0));
}

/** O líquido da nota precisa ser as operações mais os custos; com ou sem IRRF, conforme a corretora. */
function noteCloses(note: Note): boolean {
  if (note.net === null || note.unread.length > 0) return false;
  const operations = note.lines.reduce(
    (acc, line) => (line.side === "compra" ? acc.plus(line.gross) : acc.minus(line.gross)),
    money(0),
  );
  const implied = note.net.minus(operations);
  const fees = feesTotal(note);
  return (
    implied.minus(fees).abs().lte(NET_TOLERANCE) ||
    implied.minus(fees).minus(note.irrf).abs().lte(NET_TOLERANCE)
  );
}

function notesOf(lines: string[]): Note[] {
  const notes = new Map<string, Note>();
  let current: Note | null = null;
  let inTrades = false;
  lines.forEach((raw, index) => {
    const text = plainText(raw);
    if (NOTE_NUMBER.test(text)) {
      const label = text.slice(NOTE_NUMBER.exec(text)!.index);
      const block = [label, ...lines.slice(index + 1, index + 1 + HEADER_LOOKAHEAD)].join(" ");
      const fields = NOTE_FIELDS.exec(plainText(block).replace(NOTE_NUMBER, ""));
      const date = fields ? parseStatementDate(fields[2]!) : null;
      if (!fields || !date) throw new InvestmentFileError("layout");
      const key = `${fields[1]}|${date}`;
      current =
        notes.get(key) ??
        ({ date, lines: [], unread: [], fees: new Map(), irrf: money(0), net: null } as Note);
      notes.set(key, current);
      inTrades = false;
      return;
    }
    if (!current) return;
    if (TRADES_START.test(text)) {
      inTrades = true;
      return;
    }
    if (TRADES_END.test(text)) inTrades = false;
    if (inTrades) {
      const trade = readTradeLine(text, index);
      if (trade) current.lines.push(trade);
      else if (/\d,\d{2}/.test(text)) {
        current.unread.push({
          line: index,
          label: "—",
          date: current.date,
          reason: "dados_invalidos",
        });
      }
      return;
    }
    // A coluna da esquerda cai na mesma linha do resumo: o rótulo é procurado em qualquer ponto dela.
    FEES.forEach((pattern, fee) => {
      const match = pattern.exec(text);
      if (!match) return;
      const value = amountOf(match[1]!);
      // Folha com "CONTINUA" não tem valor; o da última folha é o que vale.
      current!.fees.set(fee, match[2] === "C" ? value.negated() : value);
    });
    const irrf = IRRF.exec(text);
    if (irrf) current.irrf = amountOf(irrf[1]!);
    const net = NET.exec(text);
    if (net) current.net = net[2] === "C" ? amountOf(net[1]!).negated() : amountOf(net[1]!);
  });
  return [...notes.values()];
}

/**
 * Cada nota do PDF, inclusive as de várias folhas, com as taxas rateadas pelo valor das linhas. Nota cujos
 * números não fecham continua na prévia, mas desmarcada, para a pessoa olhar.
 */
export function parseBrokerageNotes(lines: string[]): ParsedInvestmentFile {
  if (lines.join("").replace(/\s/g, "").length === 0) {
    throw new InvestmentFileError("pdf_sem_texto");
  }
  const notes = notesOf(lines);
  if (notes.length === 0) throw new InvestmentFileError("layout");
  const trades: ParsedTrade[] = [];
  const ignored: IgnoredLine[] = [];
  for (const note of notes) {
    const doubt = noteCloses(note) ? null : ("nota_nao_fecha" as const);
    const fees = shareFees(
      feesTotal(note).toFixed(2),
      note.lines.map((line) => line.gross.toFixed()),
    );
    ignored.push(...note.unread);
    note.lines.forEach((line, index) => {
      const code = TICKER_IN_TITLE.exec(line.title)?.[0];
      if (line.reason) {
        ignored.push({
          line: line.line,
          label: line.title || "—",
          date: note.date,
          reason: line.reason,
        });
        return;
      }
      trades.push({
        line: line.line,
        ticker: code ? normalizeTicker(code) : null,
        title: line.title || null,
        side: line.side,
        date: note.date,
        quantity: decimalText(line.quantity),
        unitPrice: decimalText(line.price),
        fees: fees[index]!,
        doubt,
      });
    });
  }
  const total = trades.length + ignored.length;
  if (total === 0) throw new InvestmentFileError("sem_linhas");
  if (total > INVESTMENT_FILE_MAX_LINES) throw new InvestmentFileError("muitas_linhas");
  return { kind: "nota", trades, positions: [], ignored };
}
