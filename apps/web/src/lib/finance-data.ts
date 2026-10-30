import "server-only";
import {
  accounts,
  and,
  asc,
  cashflowPlans,
  categories,
  eq,
  gte,
  householdSettings,
  lte,
  people,
  sql,
  transactions,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import {
  addMonths,
  buildMonthEntries,
  expensesByCategory,
  isYearMonth,
  money,
  monthBounds,
  monthlySeries,
  pendingEntries,
  recentMonths,
  summarizeMonth,
  toDbAmount,
  todayIn,
  yearMonthOf,
} from "@organizeup/domain";

/** Carrega o necessário para a tela de lançamentos. Transação curta, sem chamadas externas. */
export async function loadMonth(ctx: TenantContext, requestedMonth?: string | null) {
  return withHousehold(ctx, async (tx) => {
    const [settings] = await tx
      .select({ timezone: householdSettings.timezone })
      .from(householdSettings)
      .where(eq(householdSettings.householdId, ctx.householdId));
    const today = todayIn(settings?.timezone);
    const month =
      requestedMonth && isYearMonth(requestedMonth) ? requestedMonth : yearMonthOf(today);
    const { first, last } = monthBounds(month);

    const accountRows = await tx.select().from(accounts).orderBy(asc(accounts.createdAt));
    const categoryRows = await tx
      .select()
      .from(categories)
      .orderBy(asc(categories.position), asc(categories.name));
    const planRows = await tx.select().from(cashflowPlans);
    const transactionRows = await tx
      .select()
      .from(transactions)
      .where(and(gte(transactions.occurredOn, first), lte(transactions.occurredOn, last)));

    const entries = buildMonthEntries(month, planRows, transactionRows);
    return {
      month,
      today,
      accounts: accountRows,
      categories: categoryRows,
      entries,
      summary: summarizeMonth(entries),
    };
  });
}

/** Saldo atual de cada conta: saldo inicial + tudo que já foi realizado. */
export async function loadAccountBalances(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const accountRows = await tx.select().from(accounts).orderBy(asc(accounts.createdAt));
    const movements = await tx
      .select({
        accountId: transactions.accountId,
        net: sql<string>`coalesce(sum(case when ${transactions.kind} = 'receita' then ${transactions.amount} else -${transactions.amount} end), 0)`,
      })
      .from(transactions)
      .where(eq(transactions.status, "realizado"))
      .groupBy(transactions.accountId);
    const net = new Map(movements.map((m) => [m.accountId, m.net]));
    return accountRows.map((account) => ({
      ...account,
      balance: toDbAmount(money(account.openingBalance).plus(net.get(account.id) ?? "0")),
    }));
  });
}

/** Dados do painel inicial. */
export async function loadOverview(ctx: TenantContext) {
  const balances = await loadAccountBalances(ctx);
  return withHousehold(ctx, async (tx) => {
    const [settings] = await tx
      .select({
        timezone: householdSettings.timezone,
        city: householdSettings.city,
        state: householdSettings.state,
      })
      .from(householdSettings)
      .where(eq(householdSettings.householdId, ctx.householdId));
    const today = todayIn(settings?.timezone);
    const month = yearMonthOf(today);
    const months = recentMonths(month, 6);

    const categoryRows = await tx.select().from(categories);
    const planRows = await tx.select().from(cashflowPlans);
    const [peopleCount] = await tx.select({ total: sql<number>`count(*)::int` }).from(people);
    const [incomeCount] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(transactions)
      .where(eq(transactions.kind, "receita"));
    const transactionRows = await tx
      .select()
      .from(transactions)
      .where(
        and(
          gte(transactions.occurredOn, `${months[0]!}-01`),
          lte(transactions.occurredOn, monthBounds(addMonths(month, 1)).last),
        ),
      );

    const inMonth = (ym: string) =>
      buildMonthEntries(
        ym,
        planRows,
        transactionRows.filter((t) => yearMonthOf(t.occurredOn) === ym),
      );
    const current = inMonth(month);
    const previous = inMonth(addMonths(month, -1));
    const next = inMonth(addMonths(month, 1));

    const active = balances.filter((b) => !b.archived);
    return {
      month,
      today,
      place: settings?.city
        ? `${settings.city}${settings.state ? `/${settings.state}` : ""}`
        : null,
      total: toDbAmount(active.reduce((acc, b) => acc.plus(b.balance), money(0))),
      summary: summarizeMonth(current),
      previousSummary: summarizeMonth(previous),
      series: monthlySeries(months, planRows, transactionRows),
      byCategory: expensesByCategory(current),
      categoryNames: new Map(categoryRows.map((c) => [c.id, c.name])),
      pending: pendingEntries([...previous, ...current, ...next], today, 6),
      checklist: {
        income: (incomeCount?.total ?? 0) > 0 || planRows.some((p) => p.kind === "receita"),
        recurring: planRows.some((p) => p.kind === "despesa"),
        balance: balances.some((b) => !money(b.openingBalance).isZero()),
        family: (peopleCount?.total ?? 0) > 1,
      },
    };
  });
}
