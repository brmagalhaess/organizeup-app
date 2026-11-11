// O que chega de um agregador de Open Finance (Pluggy, ADR-0038) vira as mesmas linhas de um arquivo: extrato
// para a conferência de /app/importar e posição para a de /app/investimentos/importar. Aqui só a regra:
// sem rede e sem banco. Nada é gravado sem passar por aquelas telas.
import { todayIn } from "./dates";
import {
  cleanFileText,
  decimalText,
  type IgnoredLine,
  type ParsedInvestmentFile,
  type ParsedPosition,
} from "./investment-file";
import { normalizeTicker } from "./market";
import { money, toDbAmount, type MoneyValue } from "./money";
import type { StatementRow } from "./statement";

/** O plano pessoal da Pluggy aceita até 5 conexões ativas. */
export const BANK_FEED_MAX_ITEMS = 5;
/** Primeira busca de uma conta: quantos dias para trás. */
export const BANK_FEED_FIRST_DAYS = 90;
/** O mais longe que uma busca vai. */
export const BANK_FEED_MAX_DAYS = 365;
/** Dias refeitos a cada busca: o banco às vezes lança com atraso. Linha repetida não entra de novo. */
export const BANK_FEED_OVERLAP_DAYS = 7;
/** O mesmo teto de linhas de um arquivo de extrato. */
export const BANK_FEED_MAX_ROWS = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identificador da Pluggy: Client ID, conexão e conta são UUID. */
export const isFeedId = (text: string) => UUID.test(text);

/** Identificadores de conexão colados pela pessoa, um por linha ou separados por vírgula. Null: algum não serve. */
export function parseFeedItemIds(raw: string): string[] | null {
  const ids = raw
    .split(/[\s,;]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(ids)];
  if (unique.length === 0 || unique.length > BANK_FEED_MAX_ITEMS) return null;
  return unique.every(isFeedId) ? unique : null;
}

const shiftDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * De que dia a busca parte. Sem busca anterior, os últimos 90 dias; depois, uma semana antes do último dia
 * trazido. A pessoa pode pedir outra data, até um ano atrás.
 */
export function feedWindowStart(
  today: string,
  syncedOn: string | null,
  asked?: string | null,
): string {
  const oldest = shiftDays(today, -BANK_FEED_MAX_DAYS);
  const start =
    asked ??
    (syncedOn
      ? shiftDays(syncedOn, -BANK_FEED_OVERLAP_DAYS)
      : shiftDays(today, -BANK_FEED_FIRST_DAYS));
  if (start < oldest) return oldest;
  return start > today ? today : start;
}

export interface FeedTransaction {
  id: string;
  date: string;
  description?: string | null;
  descriptionRaw?: string | null;
  /** `CREDIT` entra na conta, `DEBIT` sai. */
  type?: string | null;
  amount?: number | null;
  /** `PENDING` ainda pode mudar ou sumir: só `POSTED` entra. */
  status?: string | null;
}

export interface FeedStatement {
  rows: StatementRow[];
  /** Lançamentos ainda pendentes no banco, que ficam para a próxima busca. */
  pending: number;
  /** Linhas sem data ou sem valor aproveitável. */
  skipped: number;
  /** Havia mais linhas que o teto: ficaram as mais recentes. */
  truncated: boolean;
}

const MIDNIGHT_UTC = /T00:00:00(?:\.0+)?(?:Z|\+00:00)$/;

/**
 * Dia do lançamento. Data sem hora chega como meia-noite em UTC, e é o próprio dia civil; com hora, é um
 * instante, e o dia é o do fuso da família.
 */
export function feedDateOf(raw: unknown, timezone?: string): string | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
  if (raw.length === 10 || MIDNIGHT_UTC.test(raw)) {
    const day = raw.slice(0, 10);
    return Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ? null : day;
  }
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : todayIn(timezone, at);
}

const amountOf = (raw: unknown): MoneyValue | null =>
  typeof raw === "number" && Number.isFinite(raw) ? money(raw) : null;

/** Linhas de extrato de uma conta. O identificador do banco evita que a mesma linha entre duas vezes. */
export function feedStatementOf(transactions: FeedTransaction[], timezone?: string): FeedStatement {
  const rows: StatementRow[] = [];
  let pending = 0;
  let skipped = 0;
  for (const item of transactions) {
    if (item.status === "PENDING") {
      pending += 1;
      continue;
    }
    const date = feedDateOf(item.date, timezone);
    const amount = amountOf(item.amount);
    const cents = amount ? toDbAmount(amount.abs()) : null;
    if (!date || !amount || !cents || cents === "0.00" || cents.length > 15) {
      skipped += 1;
      continue;
    }
    const kind =
      item.type === "CREDIT"
        ? "receita"
        : item.type === "DEBIT"
          ? "despesa"
          : amount.isNegative()
            ? "despesa"
            : "receita";
    const description =
      cleanFileText(item.description, 120) || cleanFileText(item.descriptionRaw, 120) || "—";
    rows.push({ date, description, amount: cents, kind, externalId: `pluggy:${item.id}` });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const truncated = rows.length > BANK_FEED_MAX_ROWS;
  return { rows: truncated ? rows.slice(-BANK_FEED_MAX_ROWS) : rows, pending, skipped, truncated };
}

export interface FeedInvestment {
  id: string;
  /** Código de negociação, quando o ativo é de bolsa. */
  code?: string | null;
  name?: string | null;
  type?: string | null;
  quantity?: number | null;
  /** Preço unitário na data da posição. */
  value?: number | null;
  /** Valor bruto: quantidade vezes preço. */
  amount?: number | null;
  /** Quanto a pessoa aplicou. */
  amountOriginal?: number | null;
  status?: string | null;
}

export interface FeedPortfolio {
  file: ParsedInvestmentFile;
  /** Preço médio pago por linha da posição, quando a instituição informa quanto foi aplicado. */
  paid: Record<string, string>;
}

const positive = (raw: unknown): MoneyValue | null => {
  const value = amountOf(raw);
  return value && value.gt(0) ? value : null;
};

/**
 * Posição em ativos de bolsa, somada por código: a mesma ação em duas corretoras vira uma linha. O que não
 * tem código de negociação (renda fixa, fundos, previdência) aparece como ignorado, com o motivo.
 */
export function feedPortfolioOf(investments: FeedInvestment[]): FeedPortfolio {
  interface Lot {
    name: string | null;
    quantity: MoneyValue;
    price: MoneyValue | null;
    applied: MoneyValue | null;
    known: boolean;
  }
  const lots = new Map<string, Lot>();
  const ignored: IgnoredLine[] = [];
  investments.forEach((item, index) => {
    const quantity = positive(item.quantity);
    if (item.status === "TOTAL_WITHDRAWAL") return;
    const ticker = normalizeTicker(item.code);
    const label = cleanFileText(item.name) || cleanFileText(item.code) || item.type || "—";
    if (!ticker) {
      // Aplicação já zerada não precisa nem aparecer.
      if (positive(item.amount) || quantity)
        ignored.push({ line: index, label, date: null, reason: "ativo_nao_listado" });
      return;
    }
    if (!quantity) return;
    const price = positive(item.value) ?? positive(item.amount)?.div(quantity) ?? null;
    const applied = positive(item.amountOriginal);
    const lot = lots.get(ticker);
    if (!lot) {
      lots.set(ticker, {
        name: cleanFileText(item.name) || null,
        quantity,
        price,
        applied,
        known: applied !== null,
      });
      return;
    }
    lot.quantity = lot.quantity.plus(quantity);
    lot.price ??= price;
    lot.known &&= applied !== null;
    lot.applied = lot.known && lot.applied && applied ? lot.applied.plus(applied) : null;
  });
  const positions: ParsedPosition[] = [];
  const paid: Record<string, string> = {};
  [...lots.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .forEach(([ticker, lot], line) => {
      positions.push({
        line,
        ticker,
        name: lot.name,
        quantity: decimalText(lot.quantity),
        closePrice: lot.price ? decimalText(lot.price) : null,
      });
      if (lot.known && lot.applied) paid[String(line)] = decimalText(lot.applied.div(lot.quantity));
    });
  return { file: { kind: "posicao", trades: [], positions, ignored }, paid };
}

export const BANK_FEED_ERRORS = [
  /** Client ID ou Client Secret recusados. */
  "credenciais",
  /** Conexão que não existe nesta aplicação, ou foi removida na Pluggy. */
  "conexao",
  /** A Pluggy pediu para esperar. */
  "limite",
  /** O plano da pessoa na Pluggy não dá acesso a este dado. */
  "sem_acesso",
  "rede",
  "resposta",
] as const;
export type BankFeedError = (typeof BANK_FEED_ERRORS)[number];
