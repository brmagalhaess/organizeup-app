// Painel por mês (docs/specs/painel.md). Puro: recebe o que já foi lido e devolve o que a tela mostra.
// As somas continuam em `summarizeMonth`, `spendingByCategory`, `incomeByCategory`, `summarizeDividends`
// e `positionOf`: aqui só se escolhe o recorte, para painel, lançamentos e relatório darem o mesmo número.
// Aporte e resgate seguem a definição de `savings.ts` (ADR-0027).
import {
  addMonths,
  monthBounds,
  monthPoint,
  percentOf,
  savingsByCategory,
  spendingByCategory,
  summarizeMonth,
  isYearMonth,
  yearMonthOf,
  type MonthEntry,
  type MonthPoint,
  type MonthSummary,
  type YearMonth,
} from "./cashflow";
import { statementStatus, type CardTerms, type StatementLine, type StatementStatus } from "./card";
import { forecastDividends } from "./dividend-retirement";
import { incomeByCategory, mergeCategoryTotals, type CategoryTotal } from "./household-statement";
import {
  netDividend,
  positionOf,
  receivedDividends,
  summarizeDividends,
  upcomingDividends,
  type DividendInput,
  type InvestmentInput,
} from "./investment";
import { money, toDbAmount, type MoneyValue } from "./money";
import { entryFlow, type SavingsRule } from "./savings";
import { monthsBetween } from "./trip";

/** Até onde o painel olha para a frente. */
export const DASHBOARD_MONTHS_AHEAD = 12;
/** Meses do gráfico de evolução, terminando no escolhido. */
export const DASHBOARD_SERIES_MONTHS = 12;
/** Categorias com linha própria; o resto vira "Outras". */
export const DASHBOARD_TOP_CATEGORIES = 6;

export type MonthPhase = "passado" | "atual" | "futuro";

export const monthPhase = (month: YearMonth, current: YearMonth): MonthPhase =>
  month < current ? "passado" : month > current ? "futuro" : "atual";

export interface DashboardPeriod {
  month: YearMonth;
  /** Mês de hoje, no fuso da família. */
  current: YearMonth;
  /** Primeiro mês que dá para escolher. */
  first: YearMonth;
  /** Último mês que dá para escolher. */
  last: YearMonth;
  phase: MonthPhase;
  /** Null no limite da faixa. */
  previous: YearMonth | null;
  next: YearMonth | null;
}

/**
 * Mês pedido no endereço. Formato errado, parâmetro repetido ou mês fora da faixa caem no mês atual: a
 * tela nunca quebra por causa de um link. A faixa vai do primeiro dado até 12 meses à frente.
 */
export function resolvePeriod(
  requested: unknown,
  today: string,
  firstMovement: string | null,
): DashboardPeriod {
  const current = yearMonthOf(today);
  const firstData = firstMovement ? yearMonthOf(firstMovement) : current;
  const first = firstData < current ? firstData : current;
  const last = addMonths(current, DASHBOARD_MONTHS_AHEAD);
  const valid =
    typeof requested === "string" &&
    isYearMonth(requested) &&
    requested >= first &&
    requested <= last;
  const month = valid ? (requested as string) : current;
  return {
    month,
    current,
    first,
    last,
    phase: monthPhase(month, current),
    previous: month > first ? addMonths(month, -1) : null,
    next: month < last ? addMonths(month, 1) : null,
  };
}

/** Anos da lista, do mais novo ao mais antigo. */
export function pickerYears(first: YearMonth, last: YearMonth): string[] {
  const from = Number(first.slice(0, 4));
  const to = Number(last.slice(0, 4));
  return Array.from({ length: to - from + 1 }, (_, index) => String(to - index));
}

/** Meses de um ano que estão na faixa, em ordem. */
export function pickerMonths(year: string, first: YearMonth, last: YearMonth): YearMonth[] {
  return Array.from(
    { length: 12 },
    (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`,
  ).filter((month) => month >= first && month <= last);
}

/** Ao trocar o ano: o mesmo mês se couber, senão o mais perto dentro da faixa. */
export function clampToRange(month: YearMonth, first: YearMonth, last: YearMonth): YearMonth {
  if (month < first) return first;
  return month > last ? last : month;
}

/** Ponto do gráfico: o feito e, à parte, o que está previsto naquele mês. */
export interface MonthPlanPoint extends MonthPoint {
  plannedIncome: string;
  plannedExpense: string;
  plannedContribution: string;
}

export const planPoint = (month: YearMonth, summary: MonthSummary): MonthPlanPoint => ({
  ...monthPoint(month, summary),
  plannedIncome: summary.plannedIncome,
  plannedExpense: summary.plannedExpense,
  plannedContribution: summary.plannedContribution,
});

const nonZero = (values: string[]) => values.some((value) => !money(value).isZero());

/** O mês teve algo feito? Aporte conta: o mês em que só se guardou dinheiro não é um mês vazio. */
export const hasMovement = (summary: MonthSummary) =>
  nonZero([summary.received, summary.spent, summary.contributed, summary.redeemed]);

/** O mês tem algo, feito ou previsto? */
export const hasAnything = (summary: MonthSummary) =>
  hasMovement(summary) ||
  nonZero([
    summary.plannedIncome,
    summary.plannedExpense,
    summary.plannedContribution,
    summary.plannedRedemption,
  ]);

/**
 * O que compara com o mês anterior. Até o mês atual, o feito; em mês futuro, em que nada aconteceu, o
 * que está previsto, somado ao feito se o anterior for o mês atual.
 */
export function comparableTotals(summary: MonthSummary, phase: MonthPhase) {
  if (phase !== "futuro") {
    return {
      income: summary.received,
      expense: summary.spent,
      contribution: summary.contributed,
      redemption: summary.redeemed,
      afterContributions: summary.afterContributions,
    };
  }
  const contribution = money(summary.contributed).plus(summary.plannedContribution);
  return {
    income: toDbAmount(money(summary.received).plus(summary.plannedIncome)),
    expense: toDbAmount(money(summary.spent).plus(summary.plannedExpense)),
    contribution: toDbAmount(contribution),
    redemption: toDbAmount(money(summary.redeemed).plus(summary.plannedRedemption)),
    afterContributions: toDbAmount(money(summary.projectedBalance).minus(contribution)),
  };
}

export interface CategoryLine extends CategoryTotal {
  /** Parte já feita. */
  done: string;
  /** Parte prevista: `amount` − `done`. */
  planned: string;
}

function splitCategories(all: CategoryTotal[], done: CategoryTotal[]): CategoryLine[] {
  const doneOf = new Map(done.map((row) => [row.categoryId, row.amount]));
  return all.map((row) => {
    const part = doneOf.get(row.categoryId) ?? "0.00";
    return { ...row, done: part, planned: toDbAmount(money(row.amount).minus(part)) };
  });
}

/**
 * Despesas por categoria, como no relatório: feito e previsto, com o cartão aberto em compras. A compra
 * é "feita" quando a fatura dela foi paga, ou seja, quando não há fatura em aberto daquele cartão no mês.
 */
export function expenseLines(
  entries: MonthEntry[],
  cardLines: Array<Pick<StatementLine, "cardId" | "categoryId" | "amount">>,
  cardCategoryId: string | undefined,
  rule: SavingsRule,
): CategoryLine[] {
  const open = new Set(entries.filter((e) => e.source === "fatura").map((e) => e.id));
  return splitCategories(
    spendingByCategory(entries, cardLines, cardCategoryId, rule),
    spendingByCategory(
      entries.filter((entry) => entry.status === "realizado"),
      cardLines.filter((line) => !open.has(line.cardId)),
      cardCategoryId,
      rule,
    ),
  );
}

/** Receitas por categoria, feitas e previstas. Resgate não é receita. */
export function incomeLines(entries: MonthEntry[], rule: SavingsRule): CategoryLine[] {
  return splitCategories(
    mergeCategoryTotals([
      entries
        .filter((entry) => entryFlow(entry, rule) === "receita")
        .map(({ categoryId, amount }) => ({ categoryId, amount })),
    ]),
    incomeByCategory(entries, rule),
  );
}

/** Aportes por categoria, feitos e previstos: o que saiu de "Despesas" tem o seu próprio bloco. */
export function contributionLines(entries: MonthEntry[], rule: SavingsRule): CategoryLine[] {
  return splitCategories(
    savingsByCategory(entries, "aporte", rule),
    savingsByCategory(
      entries.filter((entry) => entry.status === "realizado"),
      "aporte",
      rule,
    ),
  );
}

export interface FoldedLine extends CategoryLine {
  percent: number;
}

export interface FoldedCategories {
  rows: FoldedLine[];
  /** A cauda somada. Null quando tudo coube. */
  other: (Omit<FoldedLine, "categoryId"> & { count: number }) | null;
  total: string;
}

const sumOf = (values: Array<string | MoneyValue>): MoneyValue =>
  values.reduce<MoneyValue>((acc, value) => acc.plus(value), money(0));

/** As maiores categorias e "Outras". Uma só na cauda fica com o próprio nome. */
export function foldCategories(
  lines: CategoryLine[],
  limit = DASHBOARD_TOP_CATEGORIES,
): FoldedCategories {
  const total = toDbAmount(sumOf(lines.map((line) => line.amount)));
  const withPercent = (line: CategoryLine): FoldedLine => ({
    ...line,
    percent: percentOf(line.amount, total),
  });
  const fits = lines.length <= limit + 1;
  const head = fits ? lines : lines.slice(0, limit);
  const tail = fits ? [] : lines.slice(limit);
  const add = (field: "amount" | "done" | "planned") =>
    toDbAmount(sumOf(tail.map((line) => line[field])));
  return {
    rows: head.map(withPercent),
    other:
      tail.length === 0
        ? null
        : {
            amount: add("amount"),
            done: add("done"),
            planned: add("planned"),
            percent: percentOf(add("amount"), total),
            count: tail.length,
          },
    total,
  };
}

/** Os números do mês de cada conta, pelo mesmo `summarizeMonth` do total. */
export function activityByAccount(
  entries: MonthEntry[],
  rule: SavingsRule,
): Map<string, MonthSummary> {
  const ids = [...new Set(entries.map((entry) => entry.accountId))];
  return new Map(
    ids.map((id) => [
      id,
      summarizeMonth(
        entries.filter((entry) => entry.accountId === id),
        rule,
      ),
    ]),
  );
}

/**
 * Saldo que os previstos ainda vão mexer, por conta, nos meses informados. Aporte e resgate mexem no
 * saldo como sempre mexeram: o dinheiro sai da conta do mesmo jeito.
 */
export function plannedNetByAccount(months: MonthSummaryMap[]): Map<string, MoneyValue> {
  const net = new Map<string, MoneyValue>();
  for (const month of months) {
    for (const [id, summary] of month) {
      const change = money(summary.plannedIncome)
        .plus(summary.plannedRedemption)
        .minus(summary.plannedExpense)
        .minus(summary.plannedContribution);
      net.set(id, (net.get(id) ?? money(0)).plus(change));
    }
  }
  return net;
}

export type MonthSummaryMap = Map<string, MonthSummary>;

export interface AccountBalanceInput {
  id: string;
  /** Na moeda principal. */
  balance: string;
  archived: boolean;
}

/** Saldo projetado de cada conta e o total: conta arquivada não soma o saldo, mas o previsto dela sim. */
export function projectBalances<T extends AccountBalanceInput>(
  accounts: T[],
  planned: Map<string, MoneyValue>,
) {
  const rows = accounts.map((account) => ({
    ...account,
    projected: toDbAmount(money(account.balance).plus(planned.get(account.id) ?? money(0))),
  }));
  const open = accounts.filter((account) => !account.archived).map((account) => account.balance);
  return {
    rows,
    total: toDbAmount(sumOf([...open, ...planned.values()])),
  };
}

export interface CardBookEntry {
  card: CardTerms & { id: string; name: string; archived: boolean };
  lines: StatementLine[];
  paid: Set<string>;
}

export interface CardMonth {
  id: string;
  name: string;
  /** Fatura com vencimento no mês. */
  statement: string;
  /** Null sem fatura no mês. */
  status: StatementStatus | null;
  /** O que já está nas faturas depois deste mês. */
  ahead: string;
}

/** Fatura do mês e o que já está nas seguintes, contando só o que tinha sido comprado até o fim do mês. */
export function cardsInMonth(book: CardBookEntry[], month: YearMonth, today: string): CardMonth[] {
  const { last } = monthBounds(month);
  return book.flatMap(({ card, lines, paid }) => {
    const statementLines = lines.filter((line) => line.statementMonth === month);
    const later = lines.filter((line) => line.statementMonth > month && line.purchasedOn <= last);
    if (statementLines.length === 0 && later.length === 0 && card.archived) return [];
    return [
      {
        id: card.id,
        name: card.name,
        statement: toDbAmount(sumOf(statementLines.map((line) => line.amount))),
        status:
          statementLines.length === 0 ? null : statementStatus(month, card, today, paid.has(month)),
        ahead: toDbAmount(sumOf(later.map((line) => line.amount))),
      },
    ];
  });
}

/** Quanto estava aplicado no fim do dia: a posição só com as operações e eventos até a data. */
export function investedUntil(list: InvestmentInput[], date: string): string {
  return toDbAmount(
    sumOf(
      list.map(
        (item) =>
          positionOf(
            item.trades.filter((trade) => trade.occurredOn <= date),
            (item.events ?? []).filter((event) => event.comDate <= date),
          ).cost,
      ),
    ),
  );
}

export interface MonthDividends {
  /** Pagos no mês, líquidos. */
  received: string;
  /** Anunciados com pagamento no mês, depois de hoje. */
  announced: string;
  /** Anunciados com pagamento depois do mês. */
  ahead: string;
  /** Líquido dos 12 meses que terminam no escolhido. */
  last12: string;
  /** Pelo histórico, nunca somada aos anunciados. Null em mês passado ou sem histórico. */
  estimate: string | null;
}

/**
 * Proventos do mês. "Recebido" é o que tem pagamento até hoje; o que vem depois é anúncio de verdade,
 * da tabela. A estimativa fica à parte, porque repetir o histórico não é anúncio.
 */
export function dividendsInMonth(
  rows: DividendInput[],
  month: YearMonth,
  today: string,
): MonthDividends {
  const current = yearMonthOf(today);
  const paid = receivedDividends(rows, today);
  const upcoming = upcomingDividends(rows, today);
  const summary = summarizeDividends(paid, month, null);
  const net = (list: DividendInput[]) => toDbAmount(sumOf(list.map(netDividend)));
  const ahead = upcoming.filter((row) => yearMonthOf(row.paidOn) > month);
  const forecast =
    month < current
      ? []
      : forecastDividends(paid, current, monthsBetween(current, month) + 1).filter(
          (row) => row.month === month,
        );
  return {
    received: summary.months.at(-1)?.net ?? "0.00",
    announced: net(upcoming.filter((row) => yearMonthOf(row.paidOn) === month)),
    ahead: net(ahead),
    last12: summary.last12,
    estimate: forecast.length === 0 ? null : toDbAmount(sumOf(forecast.map((row) => row.amount))),
  };
}
