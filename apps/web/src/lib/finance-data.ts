import "server-only";
import {
  accountBalances,
  accounts,
  accountsWithMovement,
  accountTransfers,
  and,
  asc,
  cashflowPlans,
  categories,
  desc,
  eq,
  gte,
  householdSettings,
  householdTimezone,
  incomeSources,
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
  isYearMonth,
  money,
  monthBounds,
  monthlySeries,
  pendingEntries,
  recentMonths,
  spendingByCategory,
  summarizeMonth,
  toDbAmount,
  todayIn,
  yearMonthOf,
} from "@organizeup/domain";
import { loadCommitments } from "./commitments";
import { onboardingStatus } from "./onboarding";

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

    const { scheduled } = await loadCommitments(tx, { from: month, to: month });
    const entries = buildMonthEntries(month, planRows, transactionRows, scheduled);
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

/** Últimas transferências, da mais nova à mais antiga. */
export async function loadTransfers(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const known = new Map(
      (
        await tx
          .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
          .from(accounts)
      ).map((row) => [row.id, row]),
    );
    const rows = await tx
      .select()
      .from(accountTransfers)
      .orderBy(desc(accountTransfers.occurredOn), desc(accountTransfers.createdAt))
      .limit(20);
    return {
      today: todayIn(await householdTimezone(tx, ctx.householdId)),
      /** Conta com movimento não muda de moeda. */
      moved: [...(await accountsWithMovement(tx))],
      rows: rows.map((row) => {
        const from = known.get(row.fromAccountId);
        const to = known.get(row.toAccountId);
        return {
          id: row.id,
          fromName: from?.name ?? "Conta",
          toName: to?.name ?? "Conta",
          fromCurrency: from?.currency ?? ("BRL" as const),
          toCurrency: to?.currency ?? ("BRL" as const),
          amount: row.amount,
          toAmount: row.toAmount,
          occurredOn: row.occurredOn,
          note: row.note,
        };
      }),
    };
  });
}

/**
 * Saldo atual de cada conta (`accountBalances`): `nativeBalance` na moeda dela e `balance` em reais.
 */
export async function loadAccountBalances(ctx: TenantContext) {
  return withHousehold(ctx, (tx) => accountBalances(tx));
}

/** Dados do painel inicial. */
export async function loadOverview(ctx: TenantContext) {
  const { accounts: balances, fx } = await loadAccountBalances(ctx);
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
    const [sourceCount] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(incomeSources);
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

    const { scheduled, cardLines, cardCategoryId } = await loadCommitments(tx, {
      from: addMonths(month, -1),
      to: addMonths(month, 1),
    });
    const inMonth = (ym: string) =>
      buildMonthEntries(
        ym,
        planRows,
        transactionRows.filter((t) => yearMonthOf(t.occurredOn) === ym),
        scheduled,
      );
    const current = inMonth(month);
    const previous = inMonth(addMonths(month, -1));
    const next = inMonth(addMonths(month, 1));

    const onboarding = await onboardingStatus(tx);
    const active = balances.filter((b) => !b.archived);
    return {
      month,
      today,
      place: settings?.city
        ? `${settings.city}${settings.state ? `/${settings.state}` : ""}`
        : null,
      total: toDbAmount(active.reduce((acc, b) => acc.plus(b.balance), money(0))),
      fx,
      summary: summarizeMonth(current),
      previousSummary: summarizeMonth(previous),
      series: monthlySeries(months, planRows, transactionRows),
      byCategory: spendingByCategory(
        current,
        cardLines.filter((line) => line.statementMonth === month),
        cardCategoryId,
      ),
      categoryNames: new Map(categoryRows.map((c) => [c.id, c.name])),
      pending: pendingEntries([...previous, ...current, ...next], today, 6),
      checklist: {
        onboarding: !onboarding.pending,
        income:
          (incomeCount?.total ?? 0) > 0 ||
          (sourceCount?.total ?? 0) > 0 ||
          planRows.some((p) => p.kind === "receita"),
        recurring: planRows.some((p) => p.kind === "despesa"),
        balance: balances.some((b) => !money(b.openingBalance).isZero()),
        family: (peopleCount?.total ?? 0) > 1,
      },
    };
  });
}
