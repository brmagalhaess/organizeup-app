// Arquivos da carteira (ADR-0024): tipos e leitura de célula comuns ao Excel da B3 e à nota de corretagem.
// Puro. O conteúdo do arquivo é dado não confiável: nada aqui interpreta fórmula ou instrução, só valores.
import { checkDebtFile } from "./debt-file";
import { money, type MoneyValue } from "./money";
import { parseStatementAmount, parseStatementDate } from "./statement";

export const INVESTMENT_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const INVESTMENT_FILE_MAX_LINES = 2000;
export const INVESTMENT_FILE_ACCEPT = ".xlsx,.pdf";

export const INVESTMENT_FILE_ERRORS = [
  "vazio",
  "tamanho",
  "tipo",
  "xls_antigo",
  "layout",
  "sem_linhas",
  "muitas_linhas",
  "pdf_sem_texto",
  "pdf_com_senha",
] as const;
export type InvestmentFileErrorCode = (typeof INVESTMENT_FILE_ERRORS)[number];

/** O código vira a mensagem na tela, no idioma da pessoa. Não leva nada do conteúdo do arquivo. */
export class InvestmentFileError extends Error {
  constructor(readonly code: InvestmentFileErrorCode) {
    super(code);
    this.name = "InvestmentFileError";
  }
}

/** Tamanho, tipo pelo conteúdo e proteção contra zip bomb, antes de abrir o arquivo. */
export function checkInvestmentFile(bytes: Uint8Array, name: string): "pdf" | "xlsx" {
  if (/\.xls$/i.test(name.trim())) throw new InvestmentFileError("xls_antigo");
  if (bytes.length > INVESTMENT_FILE_MAX_BYTES) throw new InvestmentFileError("tamanho");
  const check = checkDebtFile(bytes, name);
  if (!check.ok) throw new InvestmentFileError(check.code === "vazio" ? "vazio" : "tipo");
  if (check.kind !== "pdf" && check.kind !== "xlsx") throw new InvestmentFileError("tipo");
  return check.kind;
}

export type InvestmentFileKind = "negociacao" | "movimentacao" | "posicao" | "nota";

export type TradeDoubt = "nota_nao_fecha";

export interface ParsedTrade {
  /** Linha no arquivo: identifica a operação entre a prévia e a confirmação. */
  line: number;
  /** Sem sufixo F. Null só na nota, quando o título não traz o código. */
  ticker: string | null;
  /** Especificação do título na nota: a pista para achar o código. */
  title: string | null;
  side: "compra" | "venda";
  /** Data do negócio. Na Movimentação é estimada a partir da liquidação. */
  date: string;
  quantity: string;
  unitPrice: string;
  fees: string;
  doubt: TradeDoubt | null;
}

export interface ParsedPosition {
  line: number;
  ticker: string;
  name: string | null;
  quantity: string;
  closePrice: string | null;
}

export const IGNORE_REASONS = [
  "provento",
  "evento",
  "transferencia",
  "outra_movimentacao",
  "ativo_nao_listado",
  "mercado_nao_suportado",
  "dados_invalidos",
  "valores_nao_fecham",
  "venda_maior_que_posicao",
  "classe_sem_cotacao",
  "sem_codigo",
] as const;
export type IgnoreReason = (typeof IGNORE_REASONS)[number];

export interface IgnoredLine {
  line: number;
  label: string;
  date: string | null;
  reason: IgnoreReason;
}

export interface ParsedInvestmentFile {
  kind: InvestmentFileKind;
  trades: ParsedTrade[];
  positions: ParsedPosition[];
  ignored: IgnoredLine[];
}

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Texto livre do arquivo que aparece na tela. Célula com cara de fórmula não é aproveitada: o nome poderia
 * sair depois numa exportação e virar fórmula na planilha de alguém.
 */
export function cleanFileText(raw: unknown, max = 80): string {
  if (typeof raw !== "string") return "";
  const text = raw
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return FORMULA_START.test(text) ? "" : text.slice(0, max).trim();
}

const NUMBER_TEXT = /^[\sR$\d.,()-]+$/;
const SCIENTIFIC = /^\d+(?:\.\d+)?e[-+]?\d+$/i;

/** Número de célula ou de texto em pt-BR. "-", vazio ou texto com letras não são número. */
export function decimalOf(raw: unknown): MoneyValue | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? money(raw) : null;
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (SCIENTIFIC.test(text)) return money(text);
  if (!NUMBER_TEXT.test(text)) return null;
  return parseStatementAmount(text);
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const SERIAL_MIN = 30000; // 1982
const SERIAL_MAX = 80000; // 2119

/** Data de célula: `Date`, número de série do Excel ou texto. */
export function dateOf(raw: unknown): string | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  }
  if (typeof raw === "number") {
    if (raw < SERIAL_MIN || raw > SERIAL_MAX) return null;
    return new Date(EXCEL_EPOCH + Math.floor(raw) * 86_400_000).toISOString().slice(0, 10);
  }
  return typeof raw === "string" ? parseStatementDate(raw) : null;
}

/** Quantidade e preço com até 8 casas, como `numeric(20,8)`. */
export const decimalText = (value: MoneyValue): string => value.toDecimalPlaces(8).toFixed();
