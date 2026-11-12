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
  /** Só em conta de cartão: a Pluggy manda uma linha por parcela. */
  installmentNumber?: number | null;
  totalInstallments?: number | null;
  /** Dia da compra original, quando a linha é uma parcela. */
  purchaseDate?: string | null;
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

export interface FeedCardPurchase extends StatementRow {
  /** Parcelas que ainda entram a partir desta linha. 1: à vista, ou a última parcela. */
  installments: number;
}

export interface FeedCardStatement {
  rows: FeedCardPurchase[];
  pending: number;
  /** Pagamentos de fatura e estornos: o cartão do OrganizeUp só guarda compras. */
  credits: number;
  skipped: number;
  truncated: boolean;
}

const MAX_INSTALLMENTS = 120;

/**
 * Compras de uma conta de cartão. A instituição manda uma linha por parcela, e aqui cada compra é uma linha
 * só: da parcela mais antiga do período sai a compra, com as parcelas que faltam, e o OrganizeUp distribui o
 * resto pelas faturas seguintes. As parcelas da mesma compra dividem o identificador, então a parcela do mês
 * que vem não entra de novo.
 */
export function feedCardPurchasesOf(
  transactions: FeedTransaction[],
  timezone?: string,
): FeedCardStatement {
  let pending = 0;
  let credits = 0;
  let skipped = 0;
  const singles: FeedCardPurchase[] = [];
  const plans = new Map<string, { row: FeedCardPurchase; number: number }>();
  for (const item of transactions) {
    if (item.status === "PENDING") {
      pending += 1;
      continue;
    }
    const amount = amountOf(item.amount);
    // Compra chega positiva e como DEBIT; pagamento e estorno, negativos e como CREDIT.
    if (item.type === "CREDIT" || (amount && amount.isNegative() && item.type !== "DEBIT")) {
      credits += 1;
      continue;
    }
    const date = feedDateOf(item.date, timezone);
    const cents = amount ? toDbAmount(amount.abs()) : null;
    if (!date || !amount || !cents || cents === "0.00" || cents.length > 15) {
      skipped += 1;
      continue;
    }
    const description =
      cleanFileText(item.description, 100) || cleanFileText(item.descriptionRaw, 100) || "—";
    const total = Number.isInteger(item.totalInstallments) ? item.totalInstallments! : 1;
    const number = Number.isInteger(item.installmentNumber) ? item.installmentNumber! : 1;
    if (total <= 1 || total > MAX_INSTALLMENTS || number < 1 || number > total) {
      singles.push({
        date,
        description,
        amount: cents,
        kind: "despesa",
        installments: 1,
        externalId: `pluggy:${item.id}`,
      });
      continue;
    }
    const bought = feedDateOf(item.purchaseDate, timezone) ?? "";
    // A parcela não traz o identificador da compra: dia da compra, loja, valor e número de parcelas a definem.
    const key = `pluggy:parc:${bought}:${cents}:${total}:${description.toLowerCase()}`.slice(
      0,
      200,
    );
    const known = plans.get(key);
    if (known && known.number <= number) continue;
    const left = total - number + 1;
    plans.set(key, {
      number,
      row: {
        date,
        description:
          number > 1 ? `${description} (desde ${number}/${total})`.slice(0, 120) : description,
        amount: toDbAmount(amount.abs().times(left)),
        kind: "despesa",
        installments: left,
        externalId: key,
      },
    });
  }
  const rows = [...singles, ...[...plans.values()].map((plan) => plan.row)].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  const truncated = rows.length > BANK_FEED_MAX_ROWS;
  return {
    rows: truncated ? rows.slice(-BANK_FEED_MAX_ROWS) : rows,
    pending,
    credits,
    skipped,
    truncated,
  };
}

export interface FeedInvestment {
  id: string;
  /** Código de negociação, quando o ativo é de bolsa. */
  code?: string | null;
  name?: string | null;
  type?: string | null;
  /** `STOCK`, `REAL_ESTATE_FUND`, `ETF`, `BDR`… */
  subtype?: string | null;
  quantity?: number | null;
  /** Preço unitário na data da posição. */
  value?: number | null;
  /** Valor bruto: quantidade vezes preço. */
  amount?: number | null;
  /** Quanto a pessoa aplicou. */
  amountOriginal?: number | null;
  status?: string | null;
  /** Compras e vendas do ativo, quando a instituição entrega. Costumam cobrir só os últimos 12 meses. */
  trades?: FeedTrade[] | null;
}

export interface FeedTrade {
  /** `BUY` ou `SELL`. O resto (imposto, transferência) não muda o preço médio. */
  type?: string | null;
  quantity?: number | null;
  /** Preço unitário. */
  value?: number | null;
  /** Valor bruto: quantidade vezes preço. */
  amount?: number | null;
  date?: string | null;
}

export type FeedAssetClass = "acao" | "fii" | "etf_bdr";

export interface FeedPortfolio {
  file: ParsedInvestmentFile;
  /**
   * Preço por linha da posição para entrar na conferência já preenchido: o preço médio pago, quando a
   * instituição informa o valor aplicado ou as compras e vendas, ou o preço de mercado, quando não informa.
   */
  paid: Record<string, string>;
  /** Linhas em que `paid` é estimativa (histórico pela metade, ou preço de mercado): a tela avisa. */
  estimated: string[];
  /** Tipo de cada ativo, pelo que a instituição informa. */
  classes: Record<string, FeedAssetClass>;
}

/** Tipo do ativo no OrganizeUp, a partir do tipo e do subtipo da instituição. */
export function feedAssetClass(
  type: string | null | undefined,
  subtype: string | null | undefined,
): FeedAssetClass | null {
  if (subtype === "REAL_ESTATE_FUND") return "fii";
  if (subtype === "ETF" || subtype === "BDR" || type === "ETF") return "etf_bdr";
  if (subtype === "STOCK") return "acao";
  return null;
}

const positive = (raw: unknown): MoneyValue | null => {
  const value = amountOf(raw);
  return value && value.gt(0) ? value : null;
};

export interface FeedCost {
  price: MoneyValue;
  /** As compras e vendas explicam a quantidade inteira: o preço é o que a pessoa pagou. */
  exact: boolean;
}

/** Diferença de quantidade que ainda conta como igual: arredondamento de cota fracionária. */
const SAME_QUANTITY = "0.000001";

/**
 * Preço médio pago, pelas compras e vendas em ordem de data: a compra soma ao custo, e a venda sai pelo preço
 * médio do momento. Só é exato quando o histórico explica a posição inteira. Com histórico pela metade (a
 * instituição não entrega o que é antigo), sai o preço médio do que se conhece, como estimativa. Null: nenhuma
 * compra aproveitável.
 */
export function feedCostOf(trades: FeedTrade[], quantity: MoneyValue): FeedCost | null {
  const ordered = trades
    .flatMap((trade) => {
      const amount = positive(trade.quantity);
      if (!amount || (trade.type !== "BUY" && trade.type !== "SELL")) return [];
      const gross = amountOf(trade.amount)?.abs();
      const price = gross && gross.gt(0) ? gross.div(amount) : positive(trade.value);
      if (trade.type === "BUY" && !price) return [];
      return [{ buy: trade.type === "BUY", amount, price, date: trade.date ?? "" }];
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : Number(b.buy) - Number(a.buy)));
  let held = money(0);
  let cost = money(0);
  for (const trade of ordered) {
    if (trade.buy) {
      cost = cost.plus(trade.amount.times(trade.price!));
      held = held.plus(trade.amount);
    } else if (held.gt(0)) {
      // Venda maior que o conhecido: a compra é anterior ao histórico, e o que sobra dela não se sabe.
      const sold = trade.amount.gt(held) ? held : trade.amount;
      cost = cost.minus(cost.div(held).times(sold));
      held = held.minus(sold);
    }
  }
  if (!held.gt(0)) return null;
  return { price: cost.div(held), exact: held.minus(quantity).abs().lte(SAME_QUANTITY) };
}

/**
 * Posição em ativos de bolsa, somada por código: a mesma ação em duas corretoras vira uma linha. O que não
 * tem código de negociação (renda fixa, fundos, previdência) aparece como ignorado, com o motivo.
 */
export function feedPortfolioOf(investments: FeedInvestment[]): FeedPortfolio {
  interface Lot {
    assetClass: FeedAssetClass | null;
    name: string | null;
    quantity: MoneyValue;
    /** Preço de mercado, para mostrar na conferência. */
    price: MoneyValue | null;
    /** Quanto a posição custou. Null: alguma parte dela não tem preço nenhum. */
    paid: MoneyValue | null;
    exact: boolean;
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
    // Do mais certo para o menos: o valor aplicado, o histórico de compras e vendas, o preço de mercado.
    const cost: FeedCost | null = applied
      ? { price: applied.div(quantity), exact: true }
      : (feedCostOf(item.trades ?? [], quantity) ?? (price ? { price, exact: false } : null));
    const paid = cost ? cost.price.times(quantity) : null;
    const lot = lots.get(ticker);
    if (!lot) {
      lots.set(ticker, {
        assetClass: feedAssetClass(item.type, item.subtype),
        name: cleanFileText(item.name) || null,
        quantity,
        price,
        paid,
        exact: cost?.exact ?? false,
      });
      return;
    }
    lot.quantity = lot.quantity.plus(quantity);
    lot.assetClass ??= feedAssetClass(item.type, item.subtype);
    lot.price ??= price;
    lot.paid = lot.paid && paid ? lot.paid.plus(paid) : null;
    lot.exact &&= cost?.exact ?? false;
  });
  const positions: ParsedPosition[] = [];
  const paid: Record<string, string> = {};
  const estimated: string[] = [];
  const classes: Record<string, FeedAssetClass> = {};
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
      if (lot.assetClass) classes[ticker] = lot.assetClass;
      if (!lot.paid) return;
      paid[String(line)] = decimalText(lot.paid.div(lot.quantity));
      if (!lot.exact) estimated.push(String(line));
    });
  return { file: { kind: "posicao", trades: [], positions, ignored }, paid, estimated, classes };
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
