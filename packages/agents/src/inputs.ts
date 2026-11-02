// Leituras compartilhadas por worker e web: reserva, excedente e plano por proventos. Só leem; as
// contas ficam em @organizeup/domain. Rode dentro de withHousehold / withWorkerHousehold.
import {
  and,
  asc,
  cardPurchases,
  cashflowPlans,
  categories,
  creditCards,
  dividends,
  earmarks,
  emergencyFund,
  eq,
  fiscalParameters,
  goalContributions,
  gte,
  householdCurrency,
  householdSettings,
  incomeSources,
  investments,
  investmentTrades,
  loadStockEvents,
  lte,
  netWorthInputs,
  people,
  retirementPlan,
  transactions,
  type TenantTx,
} from "@organizeup/db";
import {
  addMonths,
  ageFromBirth,
  brazilRulesApply,
  buildMonthEntries,
  CONTRIBUTION_CATEGORY,
  DEFAULT_RESERVE_MONTHS,
  essentialBaseline,
  excludeSavings,
  forecastSurplus,
  fxNoteOf,
  GOAL_CATEGORY,
  money,
  monthBounds,
  monthlyNet,
  monthlySeries,
  monthlySurplus,
  monthsBetween,
  plainIncomes,
  monthsToReserve,
  normalizeDescription,
  purchaseLines,
  receivedDividends,
  recentMonths,
  reserveStatus,
  summarizeDividends,
  summarizePortfolio,
  toDbAmount,
  todayIn,
  yearMonthOf,
  type DividendAssetInput,
  type DividendPlanInput,
  type EssentialBaseline,
  type FiscalTable,
  type FxTotalNote,
  type MonthPoint,
  type PensionInput,
  type ReserveStatus,
  type SurplusBasis,
  type SurplusResult,
  type TransactionInput,
} from "@organizeup/domain";

/** Idade padrão de aposentadoria quando a pessoa não informou. */
export const DEFAULT_RETIREMENT_AGE = 65;

async function todayOf(tx: TenantTx): Promise<string> {
  const [settings] = await tx
    .select({ timezone: householdSettings.timezone })
    .from(householdSettings);
  return todayIn(settings?.timezone);
}

/** Categorias de sistema do que a família guarda (metas e aportes): não é gasto. */
export async function savingsCategoryIds(tx: TenantTx): Promise<string[]> {
  const rows = await tx.select({ id: categories.id, name: categories.name }).from(categories);
  const wanted = new Set([GOAL_CATEGORY, CONTRIBUTION_CATEGORY].map(normalizeDescription));
  return rows.filter((row) => wanted.has(normalizeDescription(row.name))).map((row) => row.id);
}

export interface ReserveData {
  today: string;
  month: string;
  targetMonths: number;
  /** Gasto essencial informado pela família (emergency_fund.monthly_amount). */
  informedMonthly: string | null;
  /** Aporte mensal planejado (emergency_fund.contribution). */
  contribution: string | null;
  baseline: EssentialBaseline;
  /** Soma das contas marcadas como reserva, na moeda principal. */
  saved: string;
  /** Cotação usada na soma; null se só há real. */
  fx: FxTotalNote | null;
  status: ReserveStatus;
  /** Meses até completar com o aporte planejado. Null sem aporte. */
  monthsLeft: number | null;
}

/**
 * Reserva de emergência: gasto essencial de referência (informado, média de 3 meses fechados ou o
 * mês atual), meta, guardado e aporte planejado.
 */
export async function reserveInputs(
  tx: TenantTx,
  options: { today?: string } = {},
): Promise<ReserveData> {
  const today = options.today ?? (await todayOf(tx));
  const month = yearMonthOf(today);
  const closed = recentMonths(addMonths(month, -1), 3);

  const [fund] = await tx.select().from(emergencyFund);
  const marks = await tx
    .select({ accountId: earmarks.accountId })
    .from(earmarks)
    .where(eq(earmarks.purpose, "reserva"));
  const marked = new Set(marks.map((mark) => mark.accountId));
  const worth = await netWorthInputs(tx);
  const essentials = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.essential, true));
  const essential = new Set(essentials.map((category) => category.id));
  const planRows = await tx.select().from(cashflowPlans);
  const rows = await tx
    .select()
    .from(transactions)
    .where(
      and(
        gte(transactions.occurredOn, monthBounds(closed[0]!).first),
        lte(transactions.occurredOn, monthBounds(month).last),
      ),
    );
  const cards = await tx.select().from(creditCards);
  const purchases = await tx.select().from(cardPurchases);
  const lines = cards.flatMap((card) =>
    purchases
      .filter((purchase) => purchase.cardId === card.id)
      .flatMap((purchase) => purchaseLines(purchase, card)),
  );
  const sum = (values: string[]) =>
    toDbAmount(values.reduce((acc, value) => acc.plus(value), money(0)));
  const linesOf = (ym: string) =>
    lines
      .filter((line) => line.statementMonth === ym && essential.has(line.categoryId))
      .map((line) => line.amount);

  const closedTotals = closed.map((ym) =>
    sum([
      ...rows
        .filter(
          (t) =>
            yearMonthOf(t.occurredOn) === ym &&
            t.kind === "despesa" &&
            t.status === "realizado" &&
            essential.has(t.categoryId),
        )
        .map((t) => t.amount),
      ...linesOf(ym),
    ]),
  );
  const currentEntries = buildMonthEntries(
    month,
    planRows,
    rows.filter((t) => yearMonthOf(t.occurredOn) === month),
  );
  const currentTotal = sum([
    ...currentEntries
      .filter((entry) => entry.kind === "despesa" && essential.has(entry.categoryId))
      .map((entry) => entry.amount),
    ...linesOf(month),
  ]);

  const baseline = essentialBaseline(closedTotals, currentTotal, fund?.monthlyAmount ?? null);
  const targetMonths = fund?.targetMonths ?? DEFAULT_RESERVE_MONTHS;
  const reserved = worth.accounts.filter((account) => !account.archived && marked.has(account.id));
  const saved = sum(reserved.map((account) => account.balance));
  const status = reserveStatus(saved, baseline.monthly, targetMonths);
  const contribution = fund?.contribution ?? null;
  return {
    today,
    month,
    targetMonths,
    informedMonthly: fund?.monthlyAmount ?? null,
    contribution,
    baseline,
    saved,
    fx: fxNoteOf(reserved, worth.rates, worth.main),
    status,
    monthsLeft: contribution ? monthsToReserve(status.missing, contribution) : null,
  };
}

export interface SurplusData {
  /** Os 12 meses fechados, já sem o que a família guardou. */
  points: MonthPoint[];
  result: SurplusResult;
  /** `previsto` quando não há histórico e o valor veio de renda líquida − previsões de despesa. */
  basis: SurplusBasis | "previsto";
  /** Excedente que vale para a divisão (antes da folga). Pode ser negativo. */
  surplus: string;
  /** Gasto médio mensal nos meses fechados com dados. Null sem dados. */
  averageExpenses12: string | null;
  /** Renda líquida típica do mês atual (sem férias e 13º). */
  incomeMonthlyNet: string;
  /** Previsões recorrentes de despesa do mês atual, sem metas e aportes. */
  plannedExpenses: string;
}

export async function loadFiscalTables(tx: TenantTx): Promise<FiscalTable[]> {
  const rows = await tx.select().from(fiscalParameters);
  return rows.map((row) => ({
    ...(row.params as Omit<FiscalTable, "validFrom">),
    validFrom: row.validFrom,
  }));
}

/** Excedente dos últimos 12 meses fechados, sem o que a família guardou. */
export async function surplusInputs(tx: TenantTx, input: { today: string }): Promise<SurplusData> {
  const month = yearMonthOf(input.today);
  const months = recentMonths(addMonths(month, -1), 12);
  const savings = await savingsCategoryIds(tx);
  const confirmed = await tx
    .select({ transactionId: goalContributions.transactionId })
    .from(goalContributions);
  const rows: TransactionInput[] = await tx
    .select()
    .from(transactions)
    .where(
      and(
        gte(transactions.occurredOn, monthBounds(months[0]!).first),
        lte(transactions.occurredOn, monthBounds(months[months.length - 1]!).last),
      ),
    );
  const filtered = excludeSavings(rows, {
    categoryIds: savings,
    transactionIds: confirmed.flatMap((row) => (row.transactionId ? [row.transactionId] : [])),
  });
  const points = monthlySeries(months, [], filtered);
  const result = monthlySurplus(points);

  const withData = points.filter(
    (point) => money(point.received).gt(0) || money(point.spent).gt(0),
  );
  const averageExpenses12 =
    withData.length === 0
      ? null
      : toDbAmount(
          withData
            .reduce((acc, point) => acc.plus(point.spent), money(0))
            .dividedBy(withData.length),
        );

  const sources = plainIncomes(await tx.select().from(incomeSources), await householdCurrency(tx));
  const tables = sources.length > 0 ? await loadFiscalTables(tx) : [];
  const active = sources.filter(
    (source) =>
      source.startMonth <= month && (source.endMonth === null || source.endMonth >= month),
  );
  const incomeMonthlyNet = toDbAmount(
    active.reduce((acc, source) => acc.plus(monthlyNet(source, tables, month)), money(0)),
  );
  const savingsSet = new Set(savings);
  const plans = await tx.select().from(cashflowPlans).where(eq(cashflowPlans.kind, "despesa"));
  const plannedExpenses = toDbAmount(
    plans
      .filter(
        (plan) =>
          plan.startMonth <= month &&
          (plan.endMonth === null || plan.endMonth >= month) &&
          !savingsSet.has(plan.categoryId),
      )
      .reduce((acc, plan) => acc.plus(plan.amount), money(0)),
  );

  const previsto = result.basis === "sem_dados";
  return {
    points,
    result,
    basis: previsto ? "previsto" : result.basis,
    surplus: previsto ? forecastSurplus(incomeMonthlyNet, plannedExpenses) : result.usable,
    averageExpenses12,
    incomeMonthlyNet,
    plannedExpenses,
  };
}

export type RetirementPlanRow = typeof retirementPlan.$inferSelect;

export interface DividendPlanData {
  /** Pronto para `planDividendRetirement`. */
  input: DividendPlanInput;
  /** Linha de retirement_plan; null enquanto a família não salvou nada. */
  plan: RetirementPlanRow | null;
  /** De onde veio o ano alvo: informado em Configurações, derivado do nascimento, ou nenhum. */
  targetYearBasis: "informado" | "nascimento" | "sem_dados";
}

/**
 * Entradas do plano por proventos: ano alvo (informado ou `min(nascimento + idade de parar)` entre
 * titular e cônjuge), renda alvo, gasto essencial, gasto médio, pensões esperadas e os ativos com
 * proventos dos últimos 12 meses. `contribution` é o aporte informado em retirement_plan, ou zero.
 */
export async function dividendPlanInputs(
  tx: TenantTx,
  input: { today: string; essentialMonthly?: string; averageExpenses12?: string | null },
): Promise<DividendPlanData> {
  const { today } = input;
  const currentMonth = yearMonthOf(today);
  const [settings] = await tx.select().from(householdSettings);
  const [plan] = await tx.select().from(retirementPlan);
  const personRows = await tx.select().from(people).orderBy(asc(people.createdAt));
  const adults = personRows.filter(
    (person) => person.relation === "titular" || person.relation === "conjuge",
  );

  let targetYear: number | null = settings?.retirementYear ?? null;
  let targetYearBasis: DividendPlanData["targetYearBasis"] = targetYear ? "informado" : "sem_dados";
  if (targetYear === null) {
    const years = adults
      .filter((person) => person.birthYear !== null)
      .map((person) => person.birthYear! + (person.retirementAge ?? DEFAULT_RETIREMENT_AGE));
    if (years.length > 0) {
      targetYear = Math.min(...years);
      targetYearBasis = "nascimento";
    }
  }

  // INSS e pensão só entram com as regras brasileiras: fora delas, carteira e renda alvo.
  const currency = settings?.mainCurrency ?? "BRL";
  const pensions: PensionInput[] = adults
    .filter(
      (person) =>
        brazilRulesApply(currency) &&
        person.expectedPension !== null &&
        money(person.expectedPension).gt(0),
    )
    .map((person) => ({
      amount: toDbAmount(person.expectedPension!),
      ageAtTarget:
        targetYear !== null && person.birthYear !== null
          ? ageFromBirth(person.birthYear, person.birthMonth ?? 1, { year: targetYear, month: 1 })
          : null,
      retirementAge: person.retirementAge ?? DEFAULT_RETIREMENT_AGE,
    }));

  const essentialMonthly =
    input.essentialMonthly ?? (await reserveInputs(tx, { today })).baseline.monthly;
  const averageExpenses12 =
    input.averageExpenses12 !== undefined
      ? input.averageExpenses12
      : (await surplusInputs(tx, { today })).averageExpenses12;

  const stockEvents = await loadStockEvents(tx);
  const [holdings, trades, allDividends] = await Promise.all([
    tx.select().from(investments).orderBy(asc(investments.createdAt)),
    tx.select().from(investmentTrades),
    tx.select().from(dividends),
  ]);
  // O rendimento observado usa o que caiu na conta: "a receber" fica fora até o pagamento (ADR-0017).
  const paid = receivedDividends(allDividends, today);
  const portfolio = summarizePortfolio(
    holdings.map((holding) => ({
      ...holding,
      trades: trades.filter((trade) => trade.investmentId === holding.id),
      events: stockEvents.filter((event) => event.investmentId === holding.id),
    })),
  );
  const received = summarizeDividends(paid, currentMonth, null);
  const net12 = new Map(received.byInvestment.map((item) => [item.investmentId, item.net]));
  const assets: DividendAssetInput[] = holdings.map((holding, index) => {
    const own = trades.filter((trade) => trade.investmentId === holding.id);
    const firstTrade = own.map((trade) => trade.occurredOn).sort()[0];
    const firstDividend = paid
      .filter((row) => row.investmentId === holding.id)
      .map((row) => row.paidOn)
      .sort()[0];
    const since = [firstTrade, firstDividend].filter((d): d is string => Boolean(d)).sort()[0];
    return {
      id: holding.id,
      assetClass: holding.assetClass,
      value: portfolio.rows[index]!.value,
      dividendsNet12: net12.get(holding.id) ?? "0.00",
      monthsHeld: since ? monthsBetween(yearMonthOf(since), currentMonth) : 0,
      firstDividendOn: firstDividend ?? null,
    };
  });

  return {
    input: {
      today,
      targetYear,
      targetIncome: plan?.targetIncome ?? null,
      essentialMonthly,
      averageExpenses12,
      pensions,
      assets,
      expectedYield: plan?.expectedYield ?? null,
      dividendGrowth: plan?.dividendGrowth ?? "0",
      contribution: plan?.monthlyContribution ?? "0.00",
      currency,
    },
    plan: plan ?? null,
    targetYearBasis,
  };
}
