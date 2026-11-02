// Relatórios da família (ADR-0021). Puro: recebe o que o agente leu e devolve números e rótulos, sem
// frase pronta, para a tela, o PDF, o CSV e o assistente lerem a mesma coisa em qualquer idioma. Os
// totais saem das mesmas funções do painel (`summarizeMonth`, `spendingByCategory`, `summarizePortfolio`,
// `summarizeDividends`), então painel e relatório batem. Nada aqui recomenda ativo.
import {
  addMonths,
  monthPoint,
  percentChange,
  percentOf,
  planIsActiveIn,
  yearMonthOf,
  type EntryKind,
  type MonthEntry,
  type MonthPoint,
  type MonthSummary,
  type PlanInput,
  type YearMonth,
} from "./cashflow";
import type { DebtPlan, DebtPlanStrategy } from "./debt-plan";
import type { DividendForecast, DividendPlan } from "./dividend-retirement";
import type { ClassShare, DividendSummary, PortfolioSummary, TradeInput } from "./investment";
import type { MessageParams } from "./messages";
import { money, toDbAmount, type MoneyInput, type MoneyValue } from "./money";
import { entryFlow, isSavings, type FlowInput, type SavingsRule } from "./savings";
import type { NetWorthSummary } from "./wealth";

export const STATEMENT_KINDS = [
  "resumo",
  "categorias",
  "fluxo",
  "patrimonio",
  "investimentos",
  "proventos",
  "dividas",
  "metas",
  "aposentadoria",
  "anual",
] as const;
export type ReportKind = (typeof STATEMENT_KINDS)[number];

export const STATEMENT_STATUSES = ["parcial", "fechado"] as const;
export type StatementReportStatus = (typeof STATEMENT_STATUSES)[number];

/** Só as contas com data no passado têm história de verdade: os outros tipos nascem no fechamento. */
export const HISTORICAL_STATEMENT_KINDS: readonly ReportKind[] = [
  "resumo",
  "categorias",
  "fluxo",
  "patrimonio",
  "proventos",
];

export const STATEMENT_FIGURES = [
  "received",
  "spent",
  "left",
  "contributed",
  "redeemed",
  "afterContributions",
  "average12",
  "total",
  "topCategory",
  "change",
  "planned",
  "open",
  "projected",
  "net",
  "owned",
  "owed",
  "cost",
  "gain",
  "gainPercent",
  "bought",
  "sold",
  "month",
  "last12",
  "monthlyAverage",
  "thisYear",
  "withheld",
  "goalPercent",
  "balance",
  "interest",
  "interest12",
  "payoff",
  "planSaving",
  "saved",
  "missing",
  "onTime",
  "late",
  "trips",
  "coverage",
  "currentIncome",
  "targetIncome",
  "portfolio",
  "requiredPortfolio",
  "contribution",
  "requiredContribution",
  "targetYear",
  "closingYear",
  "dividends",
] as const;
export type StatementFigureId = (typeof STATEMENT_FIGURES)[number];

export const STATEMENT_SECTIONS = [
  "comparison",
  "largest",
  "evolution",
  "ranking",
  "up",
  "down",
  "plannedActual",
  "projection",
  "assets",
  "liabilities",
  "classes",
  "contributions",
  "byMonth",
  "byAsset",
  "forecast",
  "debts",
  "strategies",
  "attack",
  "goals",
  "trips",
  "income",
  "positions",
  "savings",
] as const;
export type StatementSectionId = (typeof STATEMENT_SECTIONS)[number];

export const STATEMENT_COLUMNS = [
  "item",
  "month",
  "year",
  "date",
  "amount",
  "share",
  "current",
  "previous",
  "change",
  "average12",
  "changeAverage",
  "received",
  "spent",
  "left",
  "contributed",
  "afterContributions",
  "total",
  "planned",
  "actual",
  "difference",
  "plannedIn",
  "plannedOut",
  "plannedContribution",
  "accumulated",
  "net",
  "assetClass",
  "value",
  "target",
  "goalTarget",
  "gap",
  "gain",
  "bought",
  "sold",
  "gross",
  "withheld",
  "category",
  "debt",
  "rate",
  "balance",
  "interest",
  "installments",
  "strategy",
  "payoff",
  "saving",
  "saved",
  "order",
  "months",
  "goal",
  "status",
  "progress",
  "deadline",
  "end",
  "onTime",
  "destination",
  "start",
  "missing",
  "monthly",
  "portfolio",
  "income",
] as const;
export type StatementColumn = (typeof STATEMENT_COLUMNS)[number];

/** Textos fixos dentro de uma célula: o catálogo tem cada um em `relatorios.rotulos`. */
export const STATEMENT_LABELS = [
  "entrou",
  "saiu",
  "sobrou",
  "aportado",
  "contas",
  "bens",
  "investimentos",
  "guardadoMetas",
  "dividas",
  "cartoes",
  "baseline",
  "avalanche",
  "snowball",
  "semPrazo",
  "metaPlanejando",
  "metaJuntando",
  "metaConcluida",
  "metaPausada",
  "sim",
  "nao",
  "classe_acao",
  "classe_fii",
  "classe_etf_bdr",
  "classe_renda_fixa",
  "classe_fundo",
  "classe_previdencia",
  "classe_exterior",
  "classe_outro",
] as const;
export type StatementLabel = (typeof STATEMENT_LABELS)[number];

export const STATEMENT_NOTES = [
  "incluiPrevisto",
  "semDetalhe",
  "semRecomendacao",
  "estimativa",
  "planoIncompleto",
  "anualNaoFiscal",
  "posicaoDoDia",
  /** Aporte e resgate fora de receitas e despesas. */
  "aporteAParte",
  /** Fechado antes da regra e regenerado uma vez por causa dela (ADR-0027). */
  "aporteSeparado",
] as const;
export type StatementNote = (typeof STATEMENT_NOTES)[number];

/** Número ou texto de uma célula. O valor vai cru: quem formata é quem mostra. */
export type StatementCell =
  | { money: string }
  | { percent: number }
  | { count: number }
  | { month: string }
  | { date: string }
  | { year: number }
  /** Digitado pela família ou vindo do extrato. */
  | { text: string }
  /** Nome de categoria: o padrão do sistema é traduzido na tela. */
  | { category: string }
  | { label: StatementLabel }
  | null;

export interface StatementFigure {
  id: StatementFigureId;
  value: Exclude<StatementCell, null>;
  tone?: EntryKind;
}

export interface StatementChart {
  /** `bars`: uma barra por linha, com o tamanho da coluna `series[0]`. `columns`: linhas no tempo. */
  type: "bars" | "columns";
  /** Índices das colunas desenhadas. Duas no máximo: mais que isso, a tabela responde. */
  series: number[];
}

export interface StatementSection {
  id: StatementSectionId;
  columns: StatementColumn[];
  rows: StatementCell[][];
  chart?: StatementChart;
}

/**
 * Versão da conta dos relatórios. A 2 tira aporte e resgate de receitas e despesas (ADR-0027). Entra na
 * assinatura dos tipos que mudam: é o que regenera o que estava fechado, uma vez só. Relatório gravado
 * com versão menor mostra um aviso até ser regenerado.
 */
export const STATEMENT_RULE_VERSION = 2;

/** Tipos cujos números dependem de separar aporte. Os outros não mudam com a regra. */
export const SAVINGS_STATEMENT_KINDS: readonly ReportKind[] = [
  "resumo",
  "categorias",
  "fluxo",
  "anual",
];

export interface StatementData {
  version: number;
  kind: ReportKind;
  period: string;
  /** Até que dia os números vão. */
  asOf: string;
  figures: StatementFigure[];
  sections: StatementSection[];
  notes: StatementNote[];
}

export interface StatementMessage {
  key: ReportKind;
  params: MessageParams;
}

export interface StatementDraft {
  data: StatementData;
  message: StatementMessage;
}

const PERIOD = /^\d{4}(-(0[1-9]|1[0-2]))?$/;

export const isStatementKind = (value: string): value is ReportKind =>
  (STATEMENT_KINDS as readonly string[]).includes(value);

export const isStatementPeriod = (value: string) => PERIOD.test(value);

export const isYearPeriod = (period: string) => period.length === 4;

/** Período de comparação natural: mês anterior, ou ano anterior. */
export function previousPeriod(period: string): string {
  return isYearPeriod(period) ? String(Number(period) - 1) : addMonths(period, -1);
}

const cash = (value: MoneyInput) => ({ money: toDbAmount(value) });
const sumOf = (values: MoneyInput[]): MoneyValue =>
  values.reduce<MoneyValue>((acc, value) => acc.plus(value), money(0));
const isZero = (value: MoneyInput) => money(value).isZero();
const percentCell = (value: number | null) => (value === null ? null : { percent: value });

const draft = (
  kind: ReportKind,
  period: string,
  asOf: string,
  figures: StatementFigure[],
  sections: StatementSection[],
  params: MessageParams,
  notes: StatementNote[] = [],
): StatementDraft => ({
  data: {
    version: STATEMENT_RULE_VERSION,
    kind,
    period,
    asOf,
    figures,
    sections: sections.filter((section) => section.rows.length > 0),
    notes,
  },
  message: { key: kind, params },
});

const shareOf = (part: string, whole: string) => percentOf(toDbAmount(part), toDbAmount(whole));

const moved = (point: MonthPoint) =>
  [point.received, point.spent, point.contributed, point.redeemed].some((v) => !isZero(v));

/** Média dos meses com movimento: mês sem nada lançado não dilui quem acabou de começar. */
export function monthsAverage(points: MonthPoint[]) {
  const active = points.filter(moved);
  const average = (values: string[]) =>
    active.length === 0 ? "0.00" : toDbAmount(sumOf(values).dividedBy(active.length));
  return {
    months: active.length,
    received: average(active.map((point) => point.received)),
    spent: average(active.map((point) => point.spent)),
    balance: average(active.map((point) => point.balance)),
    contributed: average(active.map((point) => point.contributed)),
  };
}

/** Tira os meses vazios do começo: família nova não vê um ano inteiro de zeros. */
export function fromFirstMovement<T>(rows: T[], hasMovement: (row: T) => boolean): T[] {
  const first = rows.findIndex(hasMovement);
  return first < 0 ? rows : rows.slice(first);
}

export interface ExpenseItem {
  description: string;
  date: string;
  amount: string;
}

/**
 * Maiores gastos feitos no mês. A fatura abre nas compras, como em `spendingByCategory`: nem some nem
 * conta duas vezes.
 */
export function largestExpenses(
  entries: MonthEntry[],
  cardLines: Array<{
    description: string;
    purchasedOn: string;
    amount: string;
    categoryId: string;
  }>,
  cardCategoryId: string | undefined,
  rule: SavingsRule,
  limit = 5,
): ExpenseItem[] {
  return [
    ...entries
      .filter(
        (entry) =>
          entryFlow(entry, rule) === "despesa" &&
          entry.status === "realizado" &&
          entry.categoryId !== cardCategoryId,
      )
      .map(({ description, date, amount }) => ({ description, date, amount })),
    ...cardLines
      .filter((line) => !isSavings(line, rule))
      .map((line) => ({
        description: line.description,
        date: line.purchasedOn,
        amount: line.amount,
      })),
  ]
    .sort(
      (a, b) =>
        money(b.amount).comparedTo(a.amount) ||
        b.date.localeCompare(a.date) ||
        a.description.localeCompare(b.description),
    )
    .slice(0, limit);
}

export interface ResumoInput {
  month: string;
  asOf: string;
  summary: MonthSummary;
  previous: MonthSummary;
  /** Os 12 meses antes deste. */
  history: MonthPoint[];
  largest: ExpenseItem[];
}

export function buildResumo(input: ResumoInput): StatementDraft | null {
  const { month, asOf, summary, previous, history, largest } = input;
  const empty = [
    summary.received,
    summary.spent,
    summary.contributed,
    summary.redeemed,
    summary.plannedIncome,
    summary.plannedExpense,
    summary.plannedContribution,
  ].every(isZero);
  if (empty) return null;
  const average = monthsAverage(history);
  const line = (label: StatementLabel, current: string, before: string, mean: string) => [
    { label },
    cash(current),
    cash(before),
    percentCell(percentChange(current, before)),
    cash(mean),
    percentCell(percentChange(current, mean)),
  ];
  return draft(
    "resumo",
    month,
    asOf,
    [
      { id: "received", value: cash(summary.received), tone: "receita" },
      { id: "spent", value: cash(summary.spent), tone: "despesa" },
      { id: "left", value: cash(summary.balance) },
      { id: "contributed", value: cash(summary.contributed) },
      { id: "afterContributions", value: cash(summary.afterContributions) },
      ...(isZero(summary.redeemed)
        ? []
        : [{ id: "redeemed" as const, value: cash(summary.redeemed) }]),
      { id: "average12", value: cash(average.balance) },
    ],
    [
      {
        id: "comparison",
        columns: ["item", "current", "previous", "change", "average12", "changeAverage"],
        rows: [
          line("entrou", summary.received, previous.received, average.received),
          line("saiu", summary.spent, previous.spent, average.spent),
          line("sobrou", summary.balance, previous.balance, average.balance),
          line("aportado", summary.contributed, previous.contributed, average.contributed),
        ],
      },
      {
        id: "largest",
        columns: ["item", "date", "amount"],
        chart: { type: "bars", series: [2] },
        rows: largest.map((item) => [
          { text: item.description },
          { date: item.date },
          cash(item.amount),
        ]),
      },
      {
        id: "evolution",
        columns: ["month", "received", "spent", "left", "contributed"],
        chart: { type: "columns", series: [1, 2] },
        rows: fromFirstMovement([...history.slice(1), monthPoint(month, summary)], moved).map(
          (point) => [
            { month: point.month },
            cash(point.received),
            cash(point.spent),
            cash(point.balance),
            cash(point.contributed),
          ],
        ),
      },
    ],
    {
      received: { money: summary.received },
      spent: { money: summary.spent },
      left: { money: summary.balance },
    },
    ["aporteAParte"],
  );
}

export interface CategoryTotal {
  categoryId: string;
  amount: string;
}

const totalOf = (rows: CategoryTotal[]) => toDbAmount(sumOf(rows.map((row) => row.amount)));

export interface CategoryChange {
  categoryId: string;
  amount: string;
  previous: string;
  /** `amount` − `previous`. */
  delta: string;
}

/** O que subiu e o que caiu de um período para o outro, com o maior movimento primeiro. */
export function categoryChanges(current: CategoryTotal[], previous: CategoryTotal[]) {
  const ids = [...new Set([...current, ...previous].map((row) => row.categoryId))];
  const amountIn = (rows: CategoryTotal[], id: string) =>
    rows.find((row) => row.categoryId === id)?.amount ?? "0.00";
  const changes: CategoryChange[] = ids.map((categoryId) => {
    const amount = amountIn(current, categoryId);
    const before = amountIn(previous, categoryId);
    return {
      categoryId,
      amount,
      previous: before,
      delta: toDbAmount(money(amount).minus(before)),
    };
  });
  const byDelta = (a: CategoryChange, b: CategoryChange) =>
    money(b.delta).abs().comparedTo(money(a.delta).abs()) ||
    a.categoryId.localeCompare(b.categoryId);
  return {
    up: changes.filter((row) => money(row.delta).gt(0)).sort(byDelta),
    down: changes.filter((row) => money(row.delta).lt(0)).sort(byDelta),
  };
}

export interface CategoriasInput {
  month: string;
  asOf: string;
  byCategory: CategoryTotal[];
  /** Aportes por categoria, fora dos gastos. */
  contributions: CategoryTotal[];
  previous: CategoryTotal[];
  names: Map<string, string>;
  /** Total de cada um dos 12 meses que terminam neste, do mais antigo ao atual. */
  evolution: Array<{ month: string; total: string }>;
}

export function buildCategorias(input: CategoriasInput): StatementDraft | null {
  const { month, asOf, byCategory, contributions, previous, names, evolution } = input;
  if (byCategory.length === 0 && contributions.length === 0) return null;
  const total = totalOf(byCategory);
  const contributed = totalOf(contributions);
  const before = totalOf(previous);
  const nameOf = (categoryId: string) => ({ category: names.get(categoryId) ?? "" });
  const { up, down } = categoryChanges(byCategory, previous);
  const changeRow = (row: CategoryChange) => [
    nameOf(row.categoryId),
    cash(row.amount),
    cash(row.previous),
    cash(row.delta),
  ];
  const top = byCategory[0];
  const change = percentChange(total, before);
  return draft(
    "categorias",
    month,
    asOf,
    [
      { id: "total", value: cash(total), tone: "despesa" },
      ...(top ? [{ id: "topCategory" as const, value: nameOf(top.categoryId) }] : []),
      ...(change === null ? [] : [{ id: "change" as const, value: { percent: change } }]),
      { id: "contributed", value: cash(contributed) },
    ],
    [
      {
        id: "ranking",
        columns: ["category", "amount", "share"],
        chart: { type: "bars", series: [1] },
        rows: byCategory.map((row) => [
          nameOf(row.categoryId),
          cash(row.amount),
          { percent: shareOf(row.amount, total) },
        ]),
      },
      {
        id: "evolution",
        columns: ["month", "total"],
        chart: { type: "columns", series: [1] },
        rows: fromFirstMovement(evolution, (point) => !isZero(point.total)).map((point) => [
          { month: point.month },
          cash(point.total),
        ]),
      },
      {
        id: "up",
        columns: ["category", "current", "previous", "difference"],
        rows: up.slice(0, 5).map(changeRow),
      },
      {
        id: "down",
        columns: ["category", "current", "previous", "difference"],
        rows: down.slice(0, 5).map(changeRow),
      },
      {
        id: "savings",
        columns: ["category", "amount", "share"],
        rows: contributions.map((row) => [
          nameOf(row.categoryId),
          cash(row.amount),
          { percent: shareOf(row.amount, contributed) },
        ]),
      },
    ],
    {
      total: { money: total },
      category: top ? nameOf(top.categoryId) : { category: "" },
      amount: { money: top?.amount ?? "0.00" },
    },
    ["incluiPrevisto", "aporteAParte"],
  );
}

export interface FluxoInput {
  month: string;
  asOf: string;
  summary: MonthSummary;
  /** Tudo o que estava previsto para o mês, feito ou não. */
  planned: { income: string; expense: string; contribution: string };
  /** Os próximos meses, com o que já se sabe deles. */
  next: Array<{ month: string; summary: MonthSummary }>;
}

/** Resultado previsto de cada mês, o aporte previsto e o que acumula depois de aportar, a partir de zero. */
export function projectMonths(next: FluxoInput["next"]) {
  let accumulated = money(0);
  return next.map(({ month, summary }) => {
    const contribution = money(summary.contributed).plus(summary.plannedContribution);
    accumulated = accumulated.plus(summary.projectedBalance).minus(contribution);
    return {
      month,
      income: toDbAmount(money(summary.received).plus(summary.plannedIncome)),
      expense: toDbAmount(money(summary.spent).plus(summary.plannedExpense)),
      left: summary.projectedBalance,
      contribution: toDbAmount(contribution),
      accumulated: toDbAmount(accumulated),
    };
  });
}

export function buildFluxo(input: FluxoInput): StatementDraft | null {
  const { month, asOf, summary, planned, next } = input;
  const projection = projectMonths(next);
  const empty =
    [
      summary.received,
      summary.spent,
      summary.contributed,
      planned.income,
      planned.expense,
      planned.contribution,
    ].every(isZero) &&
    projection.every(
      (row) => isZero(row.income) && isZero(row.expense) && isZero(row.contribution),
    );
  if (empty) return null;
  const plannedLeft = toDbAmount(money(planned.income).minus(planned.expense));
  const open = toDbAmount(money(summary.plannedIncome).minus(summary.plannedExpense));
  const line = (label: StatementLabel, forecast: string, actual: string) => [
    { label },
    cash(forecast),
    cash(actual),
    cash(money(actual).minus(forecast)),
  ];
  const last = projection.at(-1);
  return draft(
    "fluxo",
    month,
    asOf,
    [
      { id: "planned", value: cash(plannedLeft) },
      { id: "left", value: cash(summary.balance) },
      { id: "open", value: cash(open) },
      // Mês antigo não tem projeção: zero aqui diria que nada vai sobrar.
      ...(last ? [{ id: "projected" as const, value: cash(last.accumulated) }] : []),
    ],
    [
      {
        id: "plannedActual",
        columns: ["item", "planned", "actual", "difference"],
        rows: [
          line("entrou", planned.income, summary.received),
          line("saiu", planned.expense, summary.spent),
          line("sobrou", plannedLeft, summary.balance),
          line("aportado", planned.contribution, summary.contributed),
        ],
      },
      {
        id: "projection",
        columns: ["month", "plannedIn", "plannedOut", "left", "plannedContribution", "accumulated"],
        chart: { type: "columns", series: [1, 2] },
        rows: projection.map((row) => [
          { month: row.month },
          cash(row.income),
          cash(row.expense),
          cash(row.left),
          cash(row.contribution),
          cash(row.accumulated),
        ]),
      },
    ],
    { planned: { money: plannedLeft }, left: { money: summary.balance } },
    ["estimativa", "aporteAParte"],
  );
}

export interface NetWorthPoint {
  month: string;
  owned: string;
  owed: string;
  net: string;
}

export interface PatrimonioInput {
  month: string;
  asOf: string;
  /** Foto de hoje. Sem ela, fica só a foto guardada do fechamento, sem o detalhe. */
  summary: NetWorthSummary | null;
  /** Fotos do fim de cada mês, da mais antiga à mais nova. */
  history: NetWorthPoint[];
}

export function buildPatrimonio(input: PatrimonioInput): StatementDraft | null {
  const { month, asOf, summary, history } = input;
  const earlier = history.filter((point) => point.month < month);
  const stored = history.find((point) => point.month === month);
  const point: NetWorthPoint | undefined = summary
    ? { month, owned: summary.owned, owed: summary.owed, net: summary.net }
    : stored;
  if (!point || (isZero(point.owned) && isZero(point.owed))) return null;
  const before = earlier.at(-1);
  const line = (label: StatementLabel, value: string) => [{ label }, cash(value)];
  const owned = summary
    ? ([
        ["contas", summary.accounts],
        ["bens", summary.assets],
        ["investimentos", summary.investments],
        ["guardadoMetas", summary.goals],
      ] as const)
    : [];
  const owed = summary
    ? ([
        ["dividas", summary.debts],
        ["cartoes", summary.cards],
      ] as const)
    : [];
  return draft(
    "patrimonio",
    month,
    asOf,
    [
      { id: "net", value: cash(point.net) },
      { id: "owned", value: cash(point.owned), tone: "receita" },
      { id: "owed", value: cash(point.owed), tone: "despesa" },
      { id: "change", value: cash(before ? money(point.net).minus(before.net) : "0") },
    ],
    [
      {
        id: "evolution",
        columns: ["month", "net"],
        chart: { type: "columns", series: [1] },
        rows: [...earlier.slice(-11), point].map((row) => [{ month: row.month }, cash(row.net)]),
      },
      {
        id: "assets",
        columns: ["item", "amount"],
        chart: { type: "bars", series: [1] },
        rows: owned.filter(([, value]) => !isZero(value)).map(([k, v]) => line(k, v)),
      },
      {
        id: "liabilities",
        columns: ["item", "amount"],
        chart: { type: "bars", series: [1] },
        rows: owed.filter(([, value]) => !isZero(value)).map(([k, v]) => line(k, v)),
      },
    ],
    { net: { money: point.net }, owned: { money: point.owned }, owed: { money: point.owed } },
    summary ? [] : ["semDetalhe"],
  );
}

export const assetClassLabel = (assetClass: string): StatementLabel => {
  const label = `classe_${assetClass}`;
  return (STATEMENT_LABELS as readonly string[]).includes(label)
    ? (label as StatementLabel)
    : "classe_outro";
};

export interface MonthTrades {
  month: string;
  bought: string;
  sold: string;
}

export interface InvestimentosInput {
  month: string;
  asOf: string;
  portfolio: PortfolioSummary;
  /** Resultado por classe, na mesma conta da carteira. */
  gainByClass: Map<string, string>;
  /** Compras e vendas dos últimos 12 meses, do mais antigo ao deste. */
  trades: MonthTrades[];
}

const classRow = (share: ClassShare, gain: string) => [
  { label: assetClassLabel(share.assetClass) },
  cash(share.value),
  { percent: share.percent },
  share.target === null ? null : { percent: share.target },
  share.toTarget === null ? null : cash(share.toTarget),
  cash(gain),
];

export function buildInvestimentos(input: InvestimentosInput): StatementDraft | null {
  const { month, asOf, portfolio, gainByClass, trades } = input;
  const current = trades.at(-1);
  if (isZero(portfolio.total) && isZero(portfolio.cost) && !trades.some(hasTrade)) return null;
  return draft(
    "investimentos",
    month,
    asOf,
    [
      { id: "portfolio", value: cash(portfolio.total) },
      { id: "gain", value: cash(portfolio.gain) },
      { id: "gainPercent", value: { percent: portfolio.gainPercent ?? 0 } },
      { id: "bought", value: cash(current?.bought ?? "0") },
      { id: "sold", value: cash(current?.sold ?? "0") },
    ],
    [
      {
        id: "classes",
        columns: ["assetClass", "value", "share", "target", "gap", "gain"],
        chart: { type: "bars", series: [1] },
        rows: portfolio.classes.map((share) =>
          classRow(share, gainByClass.get(share.assetClass) ?? "0"),
        ),
      },
      {
        id: "contributions",
        columns: ["month", "bought", "sold"],
        chart: { type: "columns", series: [1, 2] },
        rows: trades.map((row) => [{ month: row.month }, cash(row.bought), cash(row.sold)]),
      },
    ],
    { total: { money: portfolio.total }, gain: { money: portfolio.gain } },
    ["semRecomendacao", "posicaoDoDia"],
  );
}

const hasTrade = (row: MonthTrades) => !isZero(row.bought) || !isZero(row.sold);

export interface ProventosInput {
  month: string;
  asOf: string;
  summary: DividendSummary;
  /** Nome ou código de cada ativo. */
  names: Map<string, string>;
  /** Previsão somada por mês, daqui para a frente. */
  forecast: Array<{ month: string; amount: string }>;
}

export function buildProventos(input: ProventosInput): StatementDraft | null {
  const { month, asOf, summary, names, forecast } = input;
  if (isZero(summary.last12) && forecast.length === 0) return null;
  const inMonth = summary.months.at(-1)?.net ?? "0.00";
  return draft(
    "proventos",
    month,
    asOf,
    [
      { id: "month", value: cash(inMonth), tone: "receita" },
      { id: "last12", value: cash(summary.last12) },
      { id: "monthlyAverage", value: cash(summary.monthlyAverage) },
      { id: "thisYear", value: cash(summary.thisYear) },
      { id: "withheld", value: cash(summary.withheld12) },
      ...(summary.goalPercent === null
        ? []
        : [{ id: "goalPercent" as const, value: { percent: summary.goalPercent } }]),
    ],
    [
      {
        id: "byMonth",
        columns: ["month", "amount"],
        chart: { type: "columns", series: [1] },
        rows: summary.months.map((row) => [{ month: row.month }, cash(row.net)]),
      },
      {
        id: "byAsset",
        columns: ["item", "amount", "share"],
        chart: { type: "bars", series: [1] },
        rows: summary.byInvestment.map((row) => [
          { text: names.get(row.investmentId) ?? "" },
          cash(row.net),
          { percent: shareOf(row.net, summary.last12) },
        ]),
      },
      {
        id: "forecast",
        columns: ["month", "amount"],
        chart: { type: "columns", series: [1] },
        rows: forecast.map((row) => [{ month: row.month }, cash(row.amount)]),
      },
    ],
    { month: { money: inMonth }, last12: { money: summary.last12 } },
    ["semRecomendacao", "estimativa"],
  );
}

export interface DebtStatementRow {
  name: string;
  monthlyRate: string;
  balance: string;
  /** Juros das parcelas pagas no período. */
  interestPaid: string;
  installmentsLeft: number;
}

export interface DividasInput {
  month: string;
  asOf: string;
  debts: DebtStatementRow[];
  /** Juros pagos nos 12 meses que terminam neste. */
  interest12: string;
  plan: DebtPlan | null;
}

const strategyRow = (label: StatementLabel, item: DebtPlanStrategy) => [
  { label },
  item.payoffMonth ? { month: item.payoffMonth } : { label: "semPrazo" as const },
  cash(item.totalInterest),
  cash(item.saved),
];

export function buildDividas(input: DividasInput): StatementDraft | null {
  const { month, asOf, debts, interest12, plan } = input;
  if (debts.length === 0 && isZero(interest12)) return null;
  const balance = toDbAmount(sumOf(debts.map((debt) => debt.balance)));
  const interest = toDbAmount(sumOf(debts.map((debt) => debt.interestPaid)));
  const best = plan ? plan[plan.recommended] : null;
  return draft(
    "dividas",
    month,
    asOf,
    [
      { id: "balance", value: cash(balance), tone: "despesa" },
      { id: "interest", value: cash(interest) },
      { id: "interest12", value: cash(interest12) },
      {
        id: "payoff",
        value: best?.payoffMonth ? { month: best.payoffMonth } : { label: "semPrazo" },
      },
      ...(best ? [{ id: "planSaving" as const, value: cash(best.saved) }] : []),
    ],
    [
      {
        id: "debts",
        columns: ["debt", "rate", "balance", "interest", "installments"],
        chart: { type: "bars", series: [2] },
        rows: debts.map((debt) => [
          { text: debt.name },
          { percent: money(debt.monthlyRate).toNumber() },
          cash(debt.balance),
          cash(debt.interestPaid),
          { count: debt.installmentsLeft },
        ]),
      },
      {
        id: "strategies",
        columns: ["strategy", "payoff", "interest", "saving"],
        rows: plan
          ? [
              [
                { label: "baseline" },
                plan.baseline.payoffMonth
                  ? { month: plan.baseline.payoffMonth }
                  : { label: "semPrazo" },
                cash(plan.baseline.totalInterest),
                cash("0"),
              ],
              strategyRow("avalanche", plan.avalanche),
              strategyRow("snowball", plan.snowball),
            ]
          : [],
      },
      {
        id: "attack",
        columns: ["order", "debt", "months"],
        rows: (best?.attack ?? []).map((item, index) => [
          { count: index + 1 },
          { text: item.name },
          item.month === null ? { label: "semPrazo" } : { count: item.month },
        ]),
      },
    ],
    { balance: { money: balance }, interest: { money: interest } },
    ["estimativa"],
  );
}

export interface GoalStatementRow {
  name: string;
  status: "planejando" | "juntando" | "concluida" | "pausada";
  target: string;
  saved: string;
  desiredMonth: string | null;
  planEnd: string | null;
}

export interface TripStatementRow {
  destination: string;
  startOn: string;
  total: string;
  saved: string;
  missing: string;
  /** Null quando não dá mais para juntar. */
  monthly: string | null;
}

export interface MetasInput {
  month: string;
  asOf: string;
  goals: GoalStatementRow[];
  trips: TripStatementRow[];
}

const GOAL_LABELS: Record<GoalStatementRow["status"], StatementLabel> = {
  planejando: "metaPlanejando",
  juntando: "metaJuntando",
  concluida: "metaConcluida",
  pausada: "metaPausada",
};

/** No prazo: terminou, ou o plano acaba até o mês desejado. Sem mês desejado, não há prazo a cumprir. */
export function goalOnTime(goal: GoalStatementRow): boolean | null {
  if (goal.status === "concluida") return true;
  if (!goal.desiredMonth) return null;
  return goal.planEnd !== null && goal.planEnd <= goal.desiredMonth;
}

export function buildMetas(input: MetasInput): StatementDraft | null {
  const { month, asOf, goals, trips } = input;
  if (goals.length === 0 && trips.length === 0) return null;
  const missingOf = (goal: GoalStatementRow) => {
    const left = money(goal.target).minus(goal.saved);
    return left.gt(0) ? left : money(0);
  };
  const flags = goals.map(goalOnTime);
  const saved = toDbAmount(sumOf(goals.map((goal) => goal.saved)));
  const missing = toDbAmount(sumOf(goals.map(missingOf)));
  const onTime = flags.filter((flag) => flag === true).length;
  const late = flags.filter((flag) => flag === false).length;
  return draft(
    "metas",
    month,
    asOf,
    [
      { id: "saved", value: cash(saved), tone: "receita" },
      { id: "missing", value: cash(missing) },
      { id: "onTime", value: { count: onTime } },
      { id: "late", value: { count: late } },
      { id: "trips", value: { count: trips.length } },
    ],
    [
      {
        id: "goals",
        columns: ["goal", "status", "goalTarget", "saved", "progress", "deadline", "end", "onTime"],
        rows: goals.map((goal, index) => {
          const flag = flags[index];
          return [
            { text: goal.name },
            { label: GOAL_LABELS[goal.status] },
            cash(goal.target),
            cash(goal.saved),
            { percent: Math.min(100, shareOf(goal.saved, goal.target)) },
            goal.desiredMonth ? { month: goal.desiredMonth } : null,
            goal.planEnd ? { month: goal.planEnd } : null,
            flag === null || flag === undefined ? null : { label: flag ? "sim" : "nao" },
          ];
        }),
      },
      {
        id: "trips",
        columns: ["destination", "start", "total", "saved", "missing", "monthly"],
        rows: trips.map((trip) => [
          { text: trip.destination },
          { date: trip.startOn },
          cash(trip.total),
          cash(trip.saved),
          cash(trip.missing),
          trip.monthly === null ? null : cash(trip.monthly),
        ]),
      },
    ],
    { saved: { money: saved }, missing: { money: missing }, late: late },
  );
}

export interface AposentadoriaInput {
  month: string;
  asOf: string;
  plan: DividendPlan;
  contribution: string;
  targetYear: number | null;
}

const MAX_PROJECTION_ROWS = 12;

/** Até `max` anos da projeção, sempre com o primeiro e o último. */
function projectionRows(series: DividendPlan["series"], max: number) {
  if (series.length <= max) return series;
  const step = (series.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => series[Math.round(index * step)]!);
}

export function buildAposentadoria(input: AposentadoriaInput): StatementDraft | null {
  const { month, asOf, plan, contribution, targetYear } = input;
  const portfolio = toDbAmount(money(plan.incomeBase).plus(plan.otherBase));
  const empty =
    plan.status === "sem_dados" && isZero(portfolio) && isZero(plan.currentIncome) && !targetYear;
  if (empty) return null;
  const figures: StatementFigure[] = [
    { id: "coverage", value: { percent: plan.coverage } },
    { id: "currentIncome", value: cash(plan.currentIncome), tone: "receita" },
    { id: "portfolio", value: cash(portfolio) },
    { id: "contribution", value: cash(contribution) },
  ];
  if (plan.targetIncome) figures.push({ id: "targetIncome", value: cash(plan.targetIncome) });
  if (plan.requiredPortfolio)
    figures.push({ id: "requiredPortfolio", value: cash(plan.requiredPortfolio) });
  if (plan.requiredContribution)
    figures.push({ id: "requiredContribution", value: cash(plan.requiredContribution) });
  if (targetYear) figures.push({ id: "targetYear", value: { year: targetYear } });
  if (plan.yearWithContribution)
    figures.push({ id: "closingYear", value: { year: plan.yearWithContribution } });
  return draft(
    "aposentadoria",
    month,
    asOf,
    figures,
    [
      {
        id: "projection",
        columns: ["year", "portfolio", "income"],
        chart: { type: "columns", series: [1] },
        rows: projectionRows(plan.series, MAX_PROJECTION_ROWS).map((row) => [
          { year: row.year },
          cash(row.value),
          cash(row.income),
        ]),
      },
    ],
    {
      coverage: { percent: plan.coverage },
      currentIncome: { money: plan.currentIncome },
    },
    plan.status === "ok" ? ["estimativa"] : ["estimativa", "planoIncompleto"],
  );
}

export interface AssetIncomeRow {
  name: string;
  gross: string;
  withheld: string;
}

export interface AnualInput {
  year: string;
  asOf: string;
  /** Os meses do ano até agora, do mais antigo ao mais novo. */
  months: MonthPoint[];
  expenses: CategoryTotal[];
  incomes: CategoryTotal[];
  /** Aportes por categoria, fora de `expenses`. */
  contributions: CategoryTotal[];
  names: Map<string, string>;
  dividends: AssetIncomeRow[];
  interestPaid: string;
  /** Posição no fim do ano, ou null fora de janeiro: outra data não é o fim do ano. */
  positions: NetWorthSummary | null;
}

export function buildAnual(input: AnualInput): StatementDraft | null {
  const { year, asOf, months, expenses, incomes, contributions, names } = input;
  const { dividends, interestPaid, positions } = input;
  const active = months.filter(moved);
  if (active.length === 0 && dividends.length === 0) return null;
  const received = sumOf(months.map((row) => row.received));
  const spent = sumOf(months.map((row) => row.spent));
  const left = toDbAmount(received.minus(spent));
  const contributed = sumOf(months.map((row) => row.contributed));
  const redeemed = sumOf(months.map((row) => row.redeemed));
  const contributionTotal = totalOf(contributions);
  const nameOf = (categoryId: string) => ({ category: names.get(categoryId) ?? "" });
  const expenseTotal = totalOf(expenses);
  const incomeTotal = totalOf(incomes);
  const netOf = (row: AssetIncomeRow) => money(row.gross).minus(row.withheld);
  const net = toDbAmount(sumOf(dividends.map(netOf)));
  const position = (label: StatementLabel, value: string) => [{ label }, cash(value)];
  return draft(
    "anual",
    year,
    asOf,
    [
      { id: "received", value: cash(received), tone: "receita" },
      { id: "spent", value: cash(spent), tone: "despesa" },
      { id: "left", value: cash(left) },
      { id: "contributed", value: cash(contributed) },
      { id: "afterContributions", value: cash(money(left).minus(contributed)) },
      ...(redeemed.isZero() ? [] : [{ id: "redeemed" as const, value: cash(redeemed) }]),
      { id: "monthlyAverage", value: cash(monthsAverage(months).balance) },
      { id: "dividends", value: cash(net) },
      { id: "interest", value: cash(interestPaid) },
    ],
    [
      {
        id: "evolution",
        columns: ["month", "received", "spent", "left", "contributed"],
        chart: { type: "columns", series: [1, 2] },
        rows: months.map((row) => [
          { month: row.month },
          cash(row.received),
          cash(row.spent),
          cash(row.balance),
          cash(row.contributed),
        ]),
      },
      {
        id: "income",
        columns: ["category", "amount", "share"],
        chart: { type: "bars", series: [1] },
        rows: incomes.map((row) => [
          nameOf(row.categoryId),
          cash(row.amount),
          { percent: shareOf(row.amount, incomeTotal) },
        ]),
      },
      {
        id: "ranking",
        columns: ["category", "amount", "share"],
        chart: { type: "bars", series: [1] },
        rows: expenses.map((row) => [
          nameOf(row.categoryId),
          cash(row.amount),
          { percent: shareOf(row.amount, expenseTotal) },
        ]),
      },
      {
        id: "savings",
        columns: ["category", "amount", "share"],
        rows: contributions.map((row) => [
          nameOf(row.categoryId),
          cash(row.amount),
          { percent: shareOf(row.amount, contributionTotal) },
        ]),
      },
      {
        id: "byAsset",
        columns: ["item", "gross", "withheld", "net"],
        rows: dividends.map((row) => [
          { text: row.name },
          cash(row.gross),
          cash(row.withheld),
          cash(netOf(row)),
        ]),
      },
      {
        id: "positions",
        columns: ["item", "amount"],
        rows: positions
          ? [
              position("contas", positions.accounts),
              position("bens", positions.assets),
              position("investimentos", positions.investments),
              position("dividas", positions.debts),
              position("cartoes", positions.cards),
            ]
          : [],
      },
    ],
    { received: { money: toDbAmount(received) }, spent: { money: toDbAmount(spent) } },
    ["anualNaoFiscal", "aporteAParte"],
  );
}

/** Soma por categoria de vários meses, da maior para a menor. */
export function mergeCategoryTotals(months: CategoryTotal[][]): CategoryTotal[] {
  const totals = new Map<string, MoneyValue>();
  for (const row of months.flat()) {
    totals.set(row.categoryId, (totals.get(row.categoryId) ?? money(0)).plus(row.amount));
  }
  return [...totals.entries()]
    .map(([categoryId, value]) => ({ categoryId, amount: toDbAmount(value) }))
    .sort(
      (a, b) => money(b.amount).comparedTo(a.amount) || a.categoryId.localeCompare(b.categoryId),
    );
}

export interface FigureComparison {
  id: StatementFigureId;
  current: Exclude<StatementCell, null>;
  other: Exclude<StatementCell, null>;
  /** Diferença no mesmo tipo do valor. Null quando não dá para subtrair. */
  delta: StatementCell;
  percent: number | null;
}

const numericOf = (cell: StatementCell): string | null => {
  if (!cell) return null;
  if ("money" in cell) return cell.money;
  if ("percent" in cell) return String(cell.percent);
  if ("count" in cell) return String(cell.count);
  return null;
};

function deltaOf(current: StatementCell, other: StatementCell): StatementCell {
  const a = numericOf(current);
  const b = numericOf(other);
  if (a === null || b === null || !current) return null;
  if ("money" in current) return cash(money(a).minus(b));
  const diff = money(a).minus(b).toDecimalPlaces(2).toNumber();
  return "percent" in current ? { percent: diff } : { count: diff };
}

/** Compara dois períodos do mesmo tipo pelos números que os dois têm. */
export function compareFigures(a: StatementData, b: StatementData): FigureComparison[] {
  return a.figures.flatMap((figure) => {
    const match = b.figures.find((other) => other.id === figure.id);
    const delta = match ? deltaOf(figure.value, match.value) : null;
    if (!match || !delta) return [];
    const x = numericOf(figure.value)!;
    const y = numericOf(match.value)!;
    return [
      {
        id: figure.id,
        current: figure.value,
        other: match.value,
        delta,
        percent: "money" in delta ? percentChange(x, y) : null,
      },
    ];
  });
}

/** Mesmas chaves em qualquer ordem dão o mesmo texto: o jsonb não guarda a ordem. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Tudo o que estava previsto para o mês, feito ou não: previsões recorrentes ativas e os compromissos
 * do mês (renda, fatura, parcela e meta), inclusive os já pagos. É a régua do "previsto × realizado".
 */
export function plannedForMonth(
  month: YearMonth,
  plans: Array<Pick<PlanInput, "kind" | "amount" | "startMonth" | "endMonth" | "categoryId">>,
  commitments: Array<FlowInput & { kind: EntryKind; amount: string }>,
  rule: SavingsRule,
) {
  const items = [...plans.filter((plan) => planIsActiveIn(plan, month)), ...commitments];
  const total = (flow: "receita" | "despesa" | "aporte") =>
    toDbAmount(
      sumOf(items.filter((item) => entryFlow(item, rule) === flow).map((item) => item.amount)),
    );
  return { income: total("receita"), expense: total("despesa"), contribution: total("aporte") };
}

/** Compras e vendas de cada mês. Compra custa preço e taxas; venda rende preço menos taxas. */
export function tradesByMonth(months: YearMonth[], trades: TradeInput[]): MonthTrades[] {
  return months.map((month) => {
    const own = trades.filter((trade) => yearMonthOf(trade.occurredOn) === month);
    const gross = (trade: TradeInput) => money(trade.quantity).times(trade.unitPrice);
    const side = (name: TradeInput["side"]) => own.filter((trade) => trade.side === name);
    return {
      month,
      bought: toDbAmount(sumOf(side("compra").map((trade) => gross(trade).plus(trade.fees)))),
      sold: toDbAmount(sumOf(side("venda").map((trade) => gross(trade).minus(trade.fees)))),
    };
  });
}

/** Previsão de proventos somada por mês, só com os meses que têm valor. */
export function forecastByMonth(rows: DividendForecast[]) {
  const months = [...new Set(rows.map((row) => row.month))].sort();
  return months.map((month) => ({
    month,
    amount: toDbAmount(sumOf(rows.filter((row) => row.month === month).map((row) => row.amount))),
  }));
}

/** Receitas feitas no mês por categoria, da maior para a menor. Resgate não é receita. */
export function incomeByCategory(entries: MonthEntry[], rule: SavingsRule): CategoryTotal[] {
  return mergeCategoryTotals([
    entries
      .filter((entry) => entryFlow(entry, rule) === "receita" && entry.status === "realizado")
      .map(({ categoryId, amount }) => ({ categoryId, amount })),
  ]);
}
