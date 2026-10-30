import "server-only";
import {
  accounts,
  and,
  asc,
  canWrite,
  cashflowPlans,
  categories,
  ensureFinanceDefaults,
  eq,
  gte,
  householdSettings,
  lte,
  transactions,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import {
  buildMonthEntries,
  expensesByCategory,
  isYearMonth,
  monthBounds,
  summarizeMonth,
  todayIn,
  yearMonthOf,
} from "@organizeup/domain";

/** Carrega tudo o que a tela do mês precisa. Sem chamadas externas: a transação é curta. */
export async function loadMonth(ctx: TenantContext, requestedMonth?: string | null) {
  return withHousehold(ctx, async (tx) => {
    if (canWrite(ctx)) await ensureFinanceDefaults(tx, ctx.householdId);

    const [settings] = await tx
      .select({ timezone: householdSettings.timezone })
      .from(householdSettings)
      .where(eq(householdSettings.householdId, ctx.householdId));
    const today = todayIn(settings?.timezone);
    const month =
      requestedMonth && isYearMonth(requestedMonth) ? requestedMonth : yearMonthOf(today);
    const { first, last } = monthBounds(month);

    const [accountRows, categoryRows, planRows, transactionRows] = await Promise.all([
      tx
        .select()
        .from(accounts)
        .where(eq(accounts.archived, false))
        .orderBy(asc(accounts.createdAt)),
      tx
        .select()
        .from(categories)
        .where(eq(categories.archived, false))
        .orderBy(asc(categories.position), asc(categories.name)),
      tx.select().from(cashflowPlans),
      tx
        .select()
        .from(transactions)
        .where(and(gte(transactions.occurredOn, first), lte(transactions.occurredOn, last))),
    ]);

    const entries = buildMonthEntries(
      month,
      planRows.map((p) => ({ ...p, endMonth: p.endMonth })),
      transactionRows,
    );
    return {
      month,
      today,
      accounts: accountRows,
      categories: categoryRows,
      entries,
      summary: summarizeMonth(entries),
      byCategory: expensesByCategory(entries),
    };
  });
}
