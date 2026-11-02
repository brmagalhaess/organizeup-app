// Regras do fluxo de caixa do mês. Puras: recebem dados e devolvem o que a tela mostra.
import { entryOrigin, type FxCurrency } from "./fx";
import type { Currency } from "./money";
import { money, toDbAmount, type MoneyValue } from "./money";
import { entryFlow, isSavings, type EntryFlow, type SavingsRule } from "./savings";

export type EntryKind = "receita" | "despesa";
export type EntryStatus = "previsto" | "realizado";

/** Mês no formato YYYY-MM. */
export type YearMonth = string;

export interface PlanInput {
  id: string;
  kind: EntryKind;
  description: string;
  amount: string;
  dayOfMonth: number;
  startMonth: YearMonth;
  endMonth: YearMonth | null;
  categoryId: string;
  accountId: string;
}

export interface TransactionInput {
  id: string;
  kind: EntryKind;
  description: string;
  amount: string;
  occurredOn: string;
  status: EntryStatus;
  categoryId: string;
  accountId: string;
  planId: string | null;
  planMonth: YearMonth | null;
  /** Em conta estrangeira, o que foi digitado; `amount` segue na moeda principal (ADR-0020). */
  originalAmount?: string | null;
  originalCurrency?: FxCurrency | null;
  fxRate?: string | null;
  brlAmount?: string | null;
  brlRate?: string | null;
}

export interface MonthEntry {
  /**
   * `t:<id>` lançamento; `p:<id>` previsão recorrente; `d:<id>` parcela de dívida;
   * `f:<cartão>:<mês>` fatura de cartão; `r:<renda>:<mês>:<parte>` renda;
   * `g:<meta>:<mês>` parcela planejada de uma meta (ADR-0016).
   * Só lançamentos e previsões se editam aqui.
   */
  key: string;
  source: "lancamento" | "previsao" | "parcela" | "fatura" | "renda" | "meta";
  id: string;
  kind: EntryKind;
  description: string;
  amount: string;
  date: string;
  status: EntryStatus;
  categoryId: string;
  accountId: string;
  recurring: boolean;
  /** Só em lançamento de conta estrangeira. */
  originalAmount?: string;
  originalCurrency?: Currency;
  fxRate?: string;
}

/** Compromisso já calculado (parcela ou fatura em aberto) que entra no mês pelo vencimento. */
export type ScheduledEntry = Omit<MonthEntry, "status" | "recurring" | "kind"> & {
  /** Parcelas e faturas são despesas; renda é receita. */
  kind?: EntryKind;
};

/**
 * Os números do mês (ADR-0027). Receita, despesa, aporte e resgate são fluxos separados: nada entra em
 * dois. `spent` + `contributed` e `received` + `redeemed` são tudo o que saiu e entrou nas contas.
 */
export interface MonthSummary {
  received: string;
  spent: string;
  /** Resultado: receitas menos despesas. */
  balance: string;
  /** Aportes e parcelas de meta feitos. */
  contributed: string;
  /** Resgates e entradas de meta feitos. Nem receita, nem parte do resultado. */
  redeemed: string;
  /** "Sobrou depois de aportar": resultado menos aportes. */
  afterContributions: string;
  plannedIncome: string;
  plannedExpense: string;
  plannedContribution: string;
  plannedRedemption: string;
  /** Resultado com o que ainda está previsto. */
  projectedBalance: string;
}

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isYearMonth(value: string): boolean {
  return YEAR_MONTH.test(value);
}

export function yearMonthOf(date: string): YearMonth {
  return date.slice(0, 7);
}

export function daysInMonth(ym: YearMonth): number {
  const [year, month] = ym.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthBounds(ym: YearMonth): { first: string; last: string } {
  return { first: `${ym}-01`, last: `${ym}-${String(daysInMonth(ym)).padStart(2, "0")}` };
}

export function addMonths(ym: YearMonth, delta: number): YearMonth {
  const [year, month] = ym.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Nome do mês para a tela ("outubro de 2026"). */
export function formatYearMonth(ym: YearMonth): string {
  const [year, month] = ym.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** Data da ocorrência no mês; dia 31 em fevereiro cai no último dia. */
export function occurrenceDate(dayOfMonth: number, ym: YearMonth): string {
  const day = Math.min(dayOfMonth, daysInMonth(ym));
  return `${ym}-${String(day).padStart(2, "0")}`;
}

export function planIsActiveIn(plan: Pick<PlanInput, "startMonth" | "endMonth">, ym: YearMonth) {
  return plan.startMonth <= ym && (plan.endMonth === null || plan.endMonth >= ym);
}

/**
 * Junta lançamentos e previsões do mês. Previsão já confirmada não aparece duas vezes:
 * o lançamento ligado a ela (mesmo planId e planMonth) ocupa o lugar dela.
 */
export function buildMonthEntries(
  ym: YearMonth,
  plans: PlanInput[],
  transactions: TransactionInput[],
  scheduled: ScheduledEntry[] = [],
): MonthEntry[] {
  const confirmed = new Set(
    transactions.filter((t) => t.planId && t.planMonth === ym).map((t) => t.planId),
  );
  const fromTransactions: MonthEntry[] = transactions.map((t) => {
    const origin = entryOrigin(t);
    return {
      key: `t:${t.id}`,
      source: "lancamento",
      id: t.id,
      kind: t.kind,
      description: t.description,
      amount: t.amount,
      date: t.occurredOn,
      status: t.status,
      categoryId: t.categoryId,
      accountId: t.accountId,
      recurring: t.planId !== null,
      ...(origin
        ? {
            originalAmount: origin.amount,
            originalCurrency: origin.currency,
            fxRate: origin.rate,
          }
        : {}),
    };
  });
  const fromPlans: MonthEntry[] = plans
    .filter((plan) => planIsActiveIn(plan, ym) && !confirmed.has(plan.id))
    .map((plan) => ({
      key: `p:${plan.id}`,
      source: "previsao",
      id: plan.id,
      kind: plan.kind,
      description: plan.description,
      amount: plan.amount,
      date: occurrenceDate(plan.dayOfMonth, ym),
      status: "previsto",
      categoryId: plan.categoryId,
      accountId: plan.accountId,
      recurring: true,
    }));
  const fromScheduled: MonthEntry[] = scheduled
    .filter((entry) => yearMonthOf(entry.date) === ym)
    .map((entry) => ({
      ...entry,
      kind: entry.kind ?? "despesa",
      status: "previsto",
      recurring: false,
    }));
  return [...fromTransactions, ...fromPlans, ...fromScheduled].sort(
    (a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description, "pt-BR"),
  );
}

export function summarizeMonth(entries: MonthEntry[], rule: SavingsRule): MonthSummary {
  const total = (flow: EntryFlow, status: EntryStatus): MoneyValue =>
    entries
      .filter((e) => e.status === status && entryFlow(e, rule) === flow)
      .reduce((acc, e) => acc.plus(e.amount), money(0));
  const received = total("receita", "realizado");
  const spent = total("despesa", "realizado");
  const contributed = total("aporte", "realizado");
  const plannedIncome = total("receita", "previsto");
  const plannedExpense = total("despesa", "previsto");
  const balance = received.minus(spent);
  return {
    received: toDbAmount(received),
    spent: toDbAmount(spent),
    balance: toDbAmount(balance),
    contributed: toDbAmount(contributed),
    redeemed: toDbAmount(total("resgate", "realizado")),
    afterContributions: toDbAmount(balance.minus(contributed)),
    plannedIncome: toDbAmount(plannedIncome),
    plannedExpense: toDbAmount(plannedExpense),
    plannedContribution: toDbAmount(total("aporte", "previsto")),
    plannedRedemption: toDbAmount(total("resgate", "previsto")),
    projectedBalance: toDbAmount(balance.plus(plannedIncome).minus(plannedExpense)),
  };
}

const sortedTotals = (totals: Map<string, MoneyValue>) =>
  [...totals.entries()]
    .map(([categoryId, value]) => ({ categoryId, amount: toDbAmount(value) }))
    .sort((a, b) => money(b.amount).comparedTo(money(a.amount)));

/**
 * Compra de cartão na categoria de aportes é aporte, mas chega ao mês dentro da fatura. Separa a parte
 * dela na fatura em aberto, ou no pagamento de fatura lançado: a soma do mês não muda. Só serve para somar:
 * a lista da tela continua mostrando a fatura inteira.
 */
export function splitCardSavings(
  entries: MonthEntry[],
  cardLines: Array<{ cardId: string; categoryId: string; amount: string }>,
  cardCategoryId: string | undefined,
  rule: SavingsRule,
): MonthEntry[] {
  const lines = cardLines.filter((line) => isSavings(line, rule));
  if (lines.length === 0) return entries;
  const result = entries.map((entry) => ({ ...entry }));
  const isCardEntry = (entry: MonthEntry) =>
    entry.kind === "despesa" && (entry.source === "fatura" || entry.categoryId === cardCategoryId);
  for (const line of lines) {
    let left = money(line.amount);
    const own = result.filter((e) => e.source === "fatura" && e.id === line.cardId);
    const paid = result.filter((e) => e.source !== "fatura" && isCardEntry(e));
    for (const entry of [...own, ...paid]) {
      if (left.lte(0)) break;
      const part = left.gt(entry.amount) ? money(entry.amount) : left;
      if (part.lte(0)) continue;
      entry.amount = toDbAmount(money(entry.amount).minus(part));
      left = left.minus(part);
      result.push({
        ...entry,
        key: `${entry.key}#${line.categoryId}:${result.length}`,
        source: "previsao",
        amount: toDbAmount(part),
        categoryId: line.categoryId,
      });
    }
  }
  return result;
}

/**
 * Despesas do mês, feitas e previstas, por categoria e da maior para a menor. Abre a fatura: no lugar da
 * categoria do cartão entram as compras do mês, cada uma na sua categoria. Assim a fatura paga não some
 * nem conta duas vezes. O que está na categoria do cartão sem compra por trás, como um pagamento de
 * fatura importado do banco por quem não lança as compras, fica nela: é dinheiro que saiu, e sumiria do
 * total. Aporte fica fora: `entries` vem de `splitCardSavings`, e a compra de aporte já saiu da fatura.
 */
export function spendingByCategory(
  entries: MonthEntry[],
  cardLines: Array<{ categoryId: string; amount: string }>,
  cardCategoryId: string | undefined,
  rule: SavingsRule,
) {
  const totals = new Map<string, MoneyValue>();
  const add = (categoryId: string, amount: MoneyValue | string) =>
    totals.set(categoryId, (totals.get(categoryId) ?? money(0)).plus(amount));
  let onCard = money(0);
  for (const entry of entries) {
    if (entryFlow(entry, rule) !== "despesa") continue;
    if (entry.categoryId === cardCategoryId) onCard = onCard.plus(entry.amount);
    else add(entry.categoryId, entry.amount);
  }
  for (const line of cardLines) {
    if (isSavings(line, rule)) continue;
    add(line.categoryId, line.amount);
    onCard = onCard.minus(line.amount);
  }
  if (cardCategoryId !== undefined && onCard.gt(0)) add(cardCategoryId, onCard);
  return sortedTotals(totals);
}

/** Aportes ou resgates do mês, feitos e previstos, por categoria. */
export function savingsByCategory(
  entries: MonthEntry[],
  flow: "aporte" | "resgate",
  rule: SavingsRule,
) {
  const totals = new Map<string, MoneyValue>();
  for (const entry of entries) {
    if (entryFlow(entry, rule) !== flow) continue;
    totals.set(entry.categoryId, (totals.get(entry.categoryId) ?? money(0)).plus(entry.amount));
  }
  return sortedTotals(totals);
}

export interface MonthPoint {
  month: YearMonth;
  received: string;
  spent: string;
  balance: string;
  contributed: string;
  redeemed: string;
}

/** Ponto de um mês, para séries e médias. */
export const monthPoint = (month: YearMonth, summary: MonthSummary): MonthPoint => ({
  month,
  received: summary.received,
  spent: summary.spent,
  balance: summary.balance,
  contributed: summary.contributed,
  redeemed: summary.redeemed,
});

/** Os últimos `count` meses terminando em `ym`, do mais antigo para o mais novo. */
export function recentMonths(ym: YearMonth, count: number): YearMonth[] {
  return Array.from({ length: count }, (_, index) => addMonths(ym, index - count + 1));
}

/** Compras de cartão para `splitMonthEntries`. */
export interface CardSavings {
  lines: Array<{ cardId: string; categoryId: string; amount: string; statementMonth: YearMonth }>;
  categoryId: string | undefined;
}

/** Entradas de um mês, com a compra de aporte fora da fatura: excedente e hábito leem as mesmas. */
export function splitMonthEntries(
  month: YearMonth,
  plans: PlanInput[],
  transactions: TransactionInput[],
  rule: SavingsRule,
  cards?: CardSavings,
): MonthEntry[] {
  const inMonth = transactions.filter((t) => yearMonthOf(t.occurredOn) === month);
  const lines = cards?.lines.filter((line) => line.statementMonth === month) ?? [];
  return splitCardSavings(buildMonthEntries(month, plans, inMonth), lines, cards?.categoryId, rule);
}

/** O que já aconteceu em cada mês, para médias e excedente. `cards` separa o aporte feito no cartão. */
export function monthlySeries(
  months: YearMonth[],
  plans: PlanInput[],
  transactions: TransactionInput[],
  rule: SavingsRule,
  cards?: CardSavings,
): MonthPoint[] {
  return months.map((month) =>
    monthPoint(
      month,
      summarizeMonth(splitMonthEntries(month, plans, transactions, rule, cards), rule),
    ),
  );
}

/** Contas e receitas ainda em aberto, das mais antigas para as mais novas. */
export function pendingEntries(entries: MonthEntry[], today: string, limit = 6) {
  return entries
    .filter((entry) => entry.status === "previsto")
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit)
    .map((entry) => ({ ...entry, overdue: entry.date < today }));
}

/** Variação percentual entre dois valores; null quando não há base de comparação. */
export function percentChange(current: string, previous: string): number | null {
  const base = money(previous);
  if (base.isZero()) return null;
  return money(current).minus(base).dividedBy(base).times(100).toDecimalPlaces(0).toNumber();
}

/** Quanto `part` representa de `whole`, em %, para barras e proporções. */
export function percentOf(part: string, whole: string): number {
  const base = money(whole);
  if (base.isZero()) return 0;
  return money(part).dividedBy(base).times(100).toDecimalPlaces(1).toNumber();
}

/** Topo redondo do eixo de um gráfico: o menor 1, 2, 2,5, 5 ou 10 × 10ⁿ acima do maior valor. */
export function axisCeiling(values: string[]): string {
  const peak = values.reduce((acc, value) => {
    const current = money(value).abs();
    return current.gt(acc) ? current : acc;
  }, money(0));
  if (peak.isZero()) return toDbAmount(peak);
  const magnitude = money(10).pow(peak.e);
  const ceiling = [1, 2, 2.5, 5, 10].map((s) => magnitude.times(s)).find((c) => c.gte(peak));
  return toDbAmount(ceiling ?? peak);
}

/** Mês abreviado para eixos ("out"). */
export function formatMonthShort(ym: YearMonth): string {
  const [year, month] = ym.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)))
    .replace(".", "");
}

/** Dia e mês para listas ("05/10"). */
export function formatShortDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
