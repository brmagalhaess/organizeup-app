// Agente `relatorios` (ADR-0021). Roda por último na rodada: lê o que os outros deixaram e grava um
// relatório por tipo e período em `household_statements`, só com valores e chaves. No dia 1 fecha o mês
// anterior (e, em janeiro, o ano); nos outros dias atualiza o mês corrente, parcial. Mês fechado só muda
// se a assinatura do que a família lançou nele mudar. Só dado derivado, e toda conta sai de
// `packages/domain`. Idempotente: nada muda, nada grava. O parágrafo com IA fica em `packages/ai`, fora
// desta transação.
import { createHash } from "node:crypto";
import {
  and,
  asc,
  cashflowPlans,
  categories,
  debtInstallments,
  debts,
  dividendGoals,
  dividends,
  eq,
  goalContributions,
  goals,
  gte,
  householdStatements,
  incomeSources,
  investments,
  investmentTargets,
  investmentTrades,
  loadStockEvents,
  lte,
  netWorthInputs,
  netWorthSnapshots,
  transactions,
  tripCosts,
  tripPeople,
  trips,
  type TenantTx,
} from "@organizeup/db";
import {
  addMonths,
  buildAnual,
  buildAposentadoria,
  buildCategorias,
  buildDividas,
  buildFluxo,
  buildInvestimentos,
  buildMetas,
  buildMonthEntries,
  buildPatrimonio,
  buildProventos,
  buildResumo,
  forecastByMonth,
  forecastDividends,
  HISTORICAL_STATEMENT_KINDS,
  incomeBetween,
  incomeByCategory,
  isGenericCategory,
  isYearPeriod,
  largestExpenses,
  linesTotal,
  mergeCategoryTotals,
  money,
  monthBounds,
  plannedForMonth,
  planTrip,
  receivedDividends,
  recentMonths,
  spendingByCategory,
  stableJson,
  STATEMENT_KINDS,
  summarizeDividends,
  summarizeMonth,
  summarizeNetWorth,
  summarizePortfolio,
  toDbAmount,
  tradesByMonth,
  yearMonthOf,
  type MonthPoint,
  type StatementDraft,
  type ReportKind,
  type StatementReportStatus,
} from "@organizeup/domain";
import { loadCommitments } from "./commitments";
import { currentDebtPlan } from "./debt-view";
import { loadFiscalTables } from "./inputs";
import { currentDividendPlan } from "./retirement-view";
import type { AgentInput } from "./shared";

export const RELATORIOS_AGENT = "relatorios";

/** Meses fechados que a primeira rodada preenche, para a família já ter o que comparar. */
const HISTORY_MONTHS = 12;
/** O relatório olha 12 meses antes do mês e a primeira rodada vai 12 meses para trás. */
const WINDOW_MONTHS = 26;
const NEXT_MONTHS = 3;
const FORECAST_MONTHS = 6;
/** Depois disto, a foto de hoje já não diz como o mês terminou. */
const LAST_LIVE_DAY = "03";

export interface RelatoriosResult {
  suggestions: 0;
  /** Relatórios gravados nesta rodada. */
  applied: number;
}

const once = <T>(load: () => Promise<T>) => {
  let value: Promise<T> | null = null;
  return () => (value ??= load());
};

const memo = <T>(make: (key: string) => T) => {
  const known = new Map<string, T>();
  return (key: string) => {
    const hit = known.get(key);
    if (hit !== undefined) return hit;
    const value = make(key);
    known.set(key, value);
    return value;
  };
};

/** Tudo o que os relatórios leem, uma vez só por rodada. */
async function loadSource(tx: TenantTx, today: string) {
  const thisMonth = yearMonthOf(today);
  const from = addMonths(thisMonth, -WINDOW_MONTHS);
  const to = addMonths(thisMonth, NEXT_MONTHS);
  const [plans, rows, categoryRows, snapshots, dividendRows, tradeRows] = await Promise.all([
    tx.select().from(cashflowPlans),
    tx
      .select()
      .from(transactions)
      .where(
        and(
          gte(transactions.occurredOn, monthBounds(from).first),
          lte(transactions.occurredOn, monthBounds(to).last),
        ),
      ),
    tx.select().from(categories),
    tx.select().from(netWorthSnapshots).orderBy(asc(netWorthSnapshots.month)),
    tx.select().from(dividends),
    tx.select().from(investmentTrades),
  ]);
  const commitments = await loadCommitments(tx, { from, to });
  const { scheduled, cardLines, cardCategoryId } = commitments;

  const rowsOf = memo((month) => rows.filter((row) => yearMonthOf(row.occurredOn) === month));
  const linesOf = memo((month) => cardLines.filter((line) => line.statementMonth === month));
  const entriesOf = memo((month) => buildMonthEntries(month, plans, rowsOf(month), scheduled));
  const summaryOf = memo((month) => summarizeMonth(entriesOf(month)));
  const byCategoryOf = memo((month) =>
    spendingByCategory(entriesOf(month), linesOf(month), cardCategoryId),
  );
  const pointOf = (month: string): MonthPoint => {
    const { received, spent, balance } = summaryOf(month);
    return { month, received, spent, balance };
  };

  const debtRows = once(async () => ({
    list: await tx.select().from(debts).where(eq(debts.archived, false)),
    installments: await tx.select().from(debtInstallments).orderBy(asc(debtInstallments.number)),
  }));
  const paidOn = new Map(rows.map((row) => [row.id, row.occurredOn]));
  const goalRows = once(() => tx.select().from(goals));
  const contributionRows = once(() => tx.select().from(goalContributions));

  return {
    today,
    thisMonth,
    plans,
    rows,
    rowsOf,
    linesOf,
    entriesOf,
    summaryOf,
    byCategoryOf,
    pointOf,
    categoryRows,
    names: new Map(categoryRows.map((row) => [row.id, row.name])),
    snapshots,
    dividendRows,
    tradeRows,
    cardCategoryId,
    debtRows,
    paidOn,
    goalRows,
    contributionRows,
    income: once(async () => ({
      sources: await tx.select().from(incomeSources),
      tables: await loadFiscalTables(tx),
    })),
    worth: once(async () => summarizeNetWorth(await netWorthInputs(tx))),
    retirement: once(() => currentDividendPlan(tx, today)),
    debtPlan: once(() => currentDebtPlan(tx, today)),
    assets: once(async () => {
      const events = await loadStockEvents(tx);
      const [holdings, targets] = await Promise.all([
        tx.select().from(investments).orderBy(asc(investments.createdAt)),
        tx.select().from(investmentTargets),
      ]);
      const list = holdings.map((holding) => ({
        ...holding,
        trades: tradeRows.filter((trade) => trade.investmentId === holding.id),
        events: events.filter((event) => event.investmentId === holding.id),
      }));
      return { holdings, list, targets };
    }),
  };
}

type Source = Awaited<ReturnType<typeof loadSource>>;

const monthsOf = (period: string, thisMonth: string) => {
  if (!isYearPeriod(period)) return [period];
  const months = Array.from({ length: 12 }, (_, index) => addMonths(`${period}-01`, index));
  return months.filter((month) => month <= thisMonth);
};

const lastDayOf = (period: string) =>
  isYearPeriod(period) ? `${period}-12-31` : monthBounds(period).last;

/** O que a família lançou no mês. Categoria só conta quando foi ela que escolheu uma específica. */
function entryLines(source: Source, month: string): string[] {
  const generic = new Set(
    source.categoryRows.filter((row) => isGenericCategory(row.name)).map((row) => row.id),
  );
  const chosen = (row: { categorySource: string | null; categoryId: string }) =>
    row.categorySource === "familia" && !generic.has(row.categoryId) ? row.categoryId : "";
  return [
    ...source
      .rowsOf(month)
      .map((row) =>
        ["t", row.id, row.kind, row.amount, row.occurredOn, row.status, chosen(row)].join("|"),
      ),
    ...source
      .linesOf(month)
      .map((line) => ["c", line.purchaseId, line.installment, line.amount].join("|")),
  ];
}

const dividendLines = (source: Source, month: string) =>
  source.dividendRows
    .filter((row) => row.source === "familia" && yearMonthOf(row.paidOn) === month)
    .map((row) => ["d", row.id, row.paidOn, row.gross, row.withheld].join("|"));

const tradeLines = (source: Source, month: string) =>
  source.tradeRows
    .filter((row) => yearMonthOf(row.occurredOn) === month)
    .map((row) => ["i", row.id, row.side, row.quantity, row.unitPrice, row.fees].join("|"));

async function debtLines(source: Source, month: string) {
  const { installments } = await source.debtRows();
  return installments
    .filter((row) => {
      const paid = row.transactionId ? source.paidOn.get(row.transactionId) : undefined;
      return paid !== undefined && yearMonthOf(paid) === month;
    })
    .map((row) => ["p", row.id, row.amount, row.transactionId].join("|"));
}

async function goalLines(source: Source, month: string) {
  const rows = await source.contributionRows();
  return rows
    .filter((row) => row.month === month && row.transactionId !== null)
    .map((row) => ["g", row.id, row.amount].join("|"));
}

/**
 * Assinatura do período: muda quando a família lança, edita ou apaga algo nele. A aposentadoria é uma
 * foto do fechamento, e nenhum lançamento antigo muda a foto.
 */
async function sourceHash(kind: ReportKind, period: string, source: Source) {
  const months = monthsOf(period, source.thisMonth);
  const lines: string[] = [];
  for (const month of months) {
    if (kind === "resumo" || kind === "categorias" || kind === "fluxo" || kind === "anual") {
      lines.push(...entryLines(source, month));
    }
    if (kind === "proventos" || kind === "anual") lines.push(...dividendLines(source, month));
    if (kind === "investimentos") lines.push(...tradeLines(source, month));
    if (kind === "dividas" || kind === "anual") lines.push(...(await debtLines(source, month)));
    if (kind === "metas") lines.push(...(await goalLines(source, month)));
    if (kind === "patrimonio") {
      const shot = source.snapshots.find((row) => row.month === month);
      if (shot) lines.push([shot.owned, shot.owed, shot.net].join("|"));
    }
  }
  return createHash("sha256").update(lines.sort().join("\n")).digest("hex");
}

async function fluxoDraft(source: Source, month: string, asOf: string, next: string[]) {
  const { sources, tables } = await source.income();
  const { list, installments } = await source.debtRows();
  const open = new Set(list.map((debt) => debt.id));
  const goalList = await source.goalRows();
  const contributions = await source.contributionRows();
  const activeGoals = new Set(
    goalList
      .filter((goal) => goal.status !== "pausada" && goal.status !== "concluida")
      .map((goal) => goal.id),
  );
  const planned = plannedForMonth(month, source.plans, [
    ...incomeBetween(sources, tables, month, month).map((entry) => ({
      kind: "receita" as const,
      amount: entry.amount,
    })),
    { kind: "despesa", amount: linesTotal(source.linesOf(month)) },
    ...installments
      .filter((row) => open.has(row.debtId) && yearMonthOf(row.dueDate) === month)
      .map((row) => ({ kind: "despesa" as const, amount: row.amount })),
    ...contributions
      .filter((row) => row.month === month && activeGoals.has(row.goalId))
      .map((row) => ({ kind: "despesa" as const, amount: row.amount })),
  ]);
  return buildFluxo({
    month,
    asOf,
    summary: source.summaryOf(month),
    planned,
    next: next.map((item) => ({ month: item, summary: source.summaryOf(item) })),
  });
}

async function investimentosDraft(source: Source, month: string, asOf: string) {
  const { list, targets } = await source.assets();
  const portfolio = summarizePortfolio(list, targets);
  const gains = new Map<string, ReturnType<typeof money>>();
  list.forEach((holding, index) => {
    const known = gains.get(holding.assetClass) ?? money(0);
    gains.set(holding.assetClass, known.plus(portfolio.rows[index]!.gain));
  });
  return buildInvestimentos({
    month,
    asOf,
    portfolio,
    gainByClass: new Map([...gains].map(([key, value]) => [key, toDbAmount(value)])),
    trades: tradesByMonth(recentMonths(month, 12), source.tradeRows),
  });
}

async function proventosDraft(tx: TenantTx, source: Source, month: string, asOf: string) {
  const { holdings } = await source.assets();
  const [goal] = await tx.select().from(dividendGoals);
  const paid = receivedDividends(source.dividendRows, asOf);
  const current = month >= addMonths(source.thisMonth, -1);
  return buildProventos({
    month,
    asOf,
    summary: summarizeDividends(paid, month, goal?.monthlyAmount ?? null),
    names: new Map(holdings.map((holding) => [holding.id, holding.ticker ?? holding.name])),
    forecast: current
      ? forecastByMonth(forecastDividends(paid, addMonths(month, 1), FORECAST_MONTHS))
      : [],
  });
}

/** Juros das parcelas pagas nos meses pedidos, pela data do lançamento. */
function interestPaid(
  source: Source,
  installments: Array<{ interest: string; transactionId: string | null }>,
  months: string[],
) {
  const wanted = new Set(months);
  return toDbAmount(
    installments
      .filter((row) => {
        const paid = row.transactionId ? source.paidOn.get(row.transactionId) : undefined;
        return paid !== undefined && wanted.has(yearMonthOf(paid));
      })
      .reduce((acc, row) => acc.plus(row.interest), money(0)),
  );
}

async function dividasDraft(source: Source, month: string, asOf: string) {
  const { list, installments } = await source.debtRows();
  const rows = list
    .map((debt) => {
      const own = installments.filter((row) => row.debtId === debt.id);
      const open = own.filter((row) => row.transactionId === null);
      return {
        name: debt.name,
        monthlyRate: debt.monthlyRate,
        balance: toDbAmount(open.reduce((acc, row) => acc.plus(row.principal), money(0))),
        interestPaid: interestPaid(source, own, [month]),
        installmentsLeft: open.length,
      };
    })
    .filter((row) => row.installmentsLeft > 0 || money(row.interestPaid).gt(0));
  const { plan } = await source.debtPlan();
  return buildDividas({
    month,
    asOf,
    debts: rows,
    interest12: interestPaid(source, installments, recentMonths(month, 12)),
    plan,
  });
}

async function metasDraft(tx: TenantTx, source: Source, month: string, asOf: string) {
  const [goalList, tripRows, costs, travelers] = await Promise.all([
    source.goalRows(),
    tx.select().from(trips).orderBy(asc(trips.startOn)),
    tx.select().from(tripCosts),
    tx.select().from(tripPeople),
  ]);
  return buildMetas({
    month,
    asOf,
    goals: goalList.map((goal) => ({
      name: goal.name,
      status: goal.status,
      target: goal.targetAmount,
      saved: goal.saved,
      desiredMonth: goal.desiredMonth,
      planEnd: goal.planEnd,
    })),
    trips: tripRows.flatMap((trip) => {
      const plan = planTrip(
        {
          ...trip,
          travelers: travelers.filter((row) => row.tripId === trip.id).length,
          costs: costs.filter((cost) => cost.tripId === trip.id),
        },
        source.today,
      );
      if (plan.past) return [];
      return [
        {
          destination: trip.destination,
          startOn: trip.startOn,
          total: plan.total,
          saved: trip.saved,
          missing: plan.missing,
          monthly: plan.monthly,
        },
      ];
    }),
  });
}

async function anualDraft(
  source: Source,
  year: string,
  asOf: string,
  status: StatementReportStatus,
) {
  const months = monthsOf(year, source.thisMonth);
  const { holdings } = await source.assets();
  const { installments } = await source.debtRows();
  const paid = receivedDividends(source.dividendRows, asOf).filter(
    (row) => row.paidOn.slice(0, 4) === year,
  );
  const names = new Map(holdings.map((holding) => [holding.id, holding.ticker ?? holding.name]));
  const investmentIds = [...new Set(paid.map((row) => row.investmentId))];
  const inJanuary = source.thisMonth === `${Number(year) + 1}-01`;
  return buildAnual({
    year,
    asOf,
    months: months.map(source.pointOf),
    expenses: mergeCategoryTotals(months.map(source.byCategoryOf)),
    incomes: mergeCategoryTotals(months.map((month) => incomeByCategory(source.entriesOf(month)))),
    names: source.names,
    dividends: investmentIds.map((id) => {
      const own = paid.filter((row) => row.investmentId === id);
      const sum = (values: string[]) =>
        toDbAmount(values.reduce((acc, value) => acc.plus(value), money(0)));
      return {
        name: names.get(id) ?? "",
        gross: sum(own.map((row) => row.gross)),
        withheld: sum(own.map((row) => row.withheld)),
      };
    }),
    interestPaid: interestPaid(source, installments, months),
    positions: status === "fechado" && inJanuary ? await source.worth() : null,
  });
}

async function buildStatement(
  tx: TenantTx,
  source: Source,
  kind: ReportKind,
  period: string,
  status: StatementReportStatus,
): Promise<StatementDraft | null> {
  const { summaryOf, byCategoryOf, today, thisMonth } = source;
  const asOf = status === "parcial" ? today : lastDayOf(period);
  const before = isYearPeriod(period) ? period : addMonths(period, -1);
  const closingNow = period === addMonths(thisMonth, -1);
  switch (kind) {
    case "resumo":
      return buildResumo({
        month: period,
        asOf,
        summary: summaryOf(period),
        previous: summaryOf(before),
        history: recentMonths(before, 12).map(source.pointOf),
        largest: largestExpenses(
          source.entriesOf(period),
          source.linesOf(period),
          source.cardCategoryId,
        ),
      });
    case "categorias":
      return buildCategorias({
        month: period,
        asOf,
        byCategory: byCategoryOf(period),
        previous: byCategoryOf(before),
        names: source.names,
        evolution: recentMonths(period, 12).map((month) => ({
          month,
          total: toDbAmount(
            byCategoryOf(month).reduce((acc, row) => acc.plus(row.amount), money(0)),
          ),
        })),
      });
    case "fluxo": {
      const ahead = status === "parcial" || closingNow;
      const next = Array.from({ length: NEXT_MONTHS }, (_, index) => addMonths(period, index + 1));
      return fluxoDraft(source, period, asOf, ahead ? next : []);
    }
    case "patrimonio": {
      const live = status === "parcial" || (closingNow && today.slice(8) <= LAST_LIVE_DAY);
      return buildPatrimonio({
        month: period,
        asOf,
        summary: live ? await source.worth() : null,
        history: source.snapshots,
      });
    }
    case "investimentos":
      return investimentosDraft(source, period, asOf);
    case "proventos":
      return proventosDraft(tx, source, period, asOf);
    case "dividas":
      return dividasDraft(source, period, asOf);
    case "metas":
      return metasDraft(tx, source, period, asOf);
    case "aposentadoria": {
      const { plan, contribution, planData } = await source.retirement();
      return buildAposentadoria({
        month: period,
        asOf,
        plan,
        contribution,
        targetYear: planData.input.targetYear,
      });
    }
    case "anual":
      return anualDraft(source, period, asOf, status);
  }
}

interface StoredRow {
  kind: ReportKind;
  period: string;
  status: StatementReportStatus;
  sourceHash: string | null;
  data: unknown;
  messageParams: unknown;
}

/** Mês antigo sem nada lançado não vira relatório vazio. */
function hasActivity(source: Source, kind: ReportKind, period: string) {
  if (kind === "patrimonio") return source.snapshots.some((row) => row.month === period);
  if (kind === "proventos")
    return source.dividendRows.some((row) => yearMonthOf(row.paidOn) === period);
  return source.rowsOf(period).length > 0 || source.linesOf(period).length > 0;
}

/** Tudo o que deveria estar fechado hoje: o que ficou parcial para trás entra junto. */
function closingTargets(thisMonth: string, stored: StoredRow[]) {
  const previous = addMonths(thisMonth, -1);
  const targets = new Map<string, { kind: ReportKind; period: string }>();
  const add = (kind: ReportKind, period: string) =>
    targets.set(`${kind}:${period}`, { kind, period });
  for (const kind of STATEMENT_KINDS) if (kind !== "anual") add(kind, previous);
  for (const kind of HISTORICAL_STATEMENT_KINDS) {
    for (const month of recentMonths(addMonths(previous, -1), HISTORY_MONTHS - 1)) {
      add(kind, month);
    }
  }
  add("anual", String(Number(thisMonth.slice(0, 4)) - 1));
  const year = thisMonth.slice(0, 4);
  for (const row of stored) {
    const behind = isYearPeriod(row.period) ? row.period < year : row.period < thisMonth;
    if (row.status === "parcial" && behind) add(row.kind, row.period);
  }
  return [...targets.values()];
}

const messageOf = (draft: StatementDraft) => ({
  messageKey: draft.message.key,
  messageParams: draft.message.params,
});

async function removeStatement(tx: TenantTx, kind: ReportKind, period: string) {
  await tx
    .delete(householdStatements)
    .where(and(eq(householdStatements.kind, kind), eq(householdStatements.period, period)));
}

const sameRow = (row: StoredRow, draft: StatementDraft) =>
  stableJson(row.data) === stableJson(draft.data) &&
  stableJson(row.messageParams ?? null) === stableJson(draft.message.params);

async function closeOne(
  tx: TenantTx,
  input: AgentInput,
  source: Source,
  target: { kind: ReportKind; period: string },
  row: StoredRow | undefined,
): Promise<number> {
  const { kind, period } = target;
  const hash = await sourceHash(kind, period, source);
  const closed = row?.status === "fechado";
  if (closed && row?.sourceHash === hash) return 0;
  if (!row && !isYearPeriod(period)) {
    // Foto de hoje só serve de fechamento no dia 1: depois disso, ela não é mais a do mês que passou.
    const historical = HISTORICAL_STATEMENT_KINDS.includes(kind);
    if (historical ? !hasActivity(source, kind, period) : !input.today.endsWith("-01")) return 0;
  }
  const draft = await buildStatement(tx, source, kind, period, "fechado");
  if (!draft) {
    if (row) await removeStatement(tx, kind, period);
    return row ? 1 : 0;
  }
  const now = new Date();
  const values = {
    data: draft.data,
    ...messageOf(draft),
    status: "fechado" as const,
    sourceHash: hash,
    generatedAt: now,
  };
  // A família lançou depois de o mês fechar: o parágrafo falava de outros números e sai.
  const change = closed
    ? { ...values, revisedAt: now, whatChanged: null, whatChangedLocale: null }
    : { ...values, closedAt: now };
  await tx
    .insert(householdStatements)
    .values({ householdId: input.householdId, kind, period, ...change })
    .onConflictDoUpdate({
      target: [
        householdStatements.householdId,
        householdStatements.kind,
        householdStatements.period,
      ],
      set: change,
    });
  return 1;
}

async function refreshOne(
  tx: TenantTx,
  input: AgentInput,
  source: Source,
  kind: ReportKind,
  period: string,
  row: StoredRow | undefined,
): Promise<number> {
  const draft = await buildStatement(tx, source, kind, period, "parcial");
  if (!draft) {
    if (row) await removeStatement(tx, kind, period);
    return row ? 1 : 0;
  }
  if (row && sameRow(row, draft)) return 0;
  const values = {
    data: draft.data,
    ...messageOf(draft),
    status: "parcial" as const,
    sourceHash: await sourceHash(kind, period, source),
    generatedAt: new Date(),
  };
  await tx
    .insert(householdStatements)
    .values({ householdId: input.householdId, kind, period, ...values })
    .onConflictDoUpdate({
      target: [
        householdStatements.householdId,
        householdStatements.kind,
        householdStatements.period,
      ],
      set: values,
    });
  return 1;
}

export async function runRelatoriosAgent(
  tx: TenantTx,
  input: AgentInput,
): Promise<RelatoriosResult> {
  const { today } = input;
  const source = await loadSource(tx, today);
  const { thisMonth } = source;
  const stored = (await tx
    .select({
      kind: householdStatements.kind,
      period: householdStatements.period,
      status: householdStatements.status,
      sourceHash: householdStatements.sourceHash,
      data: householdStatements.data,
      messageParams: householdStatements.messageParams,
    })
    .from(householdStatements)) as StoredRow[];
  const rowOf = (kind: ReportKind, period: string) =>
    stored.find((row) => row.kind === kind && row.period === period);

  let applied = 0;
  for (const target of closingTargets(thisMonth, stored)) {
    applied += await closeOne(tx, input, source, target, rowOf(target.kind, target.period));
  }
  // No dia 1 só fecha: o mês novo começa a aparecer no dia seguinte.
  if (today.slice(8) !== "01") {
    for (const kind of STATEMENT_KINDS) {
      const period = kind === "anual" ? thisMonth.slice(0, 4) : thisMonth;
      applied += await refreshOne(tx, input, source, kind, period, rowOf(kind, period));
    }
  }
  return { suggestions: 0, applied };
}
