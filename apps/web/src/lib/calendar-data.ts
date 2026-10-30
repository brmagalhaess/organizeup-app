import "server-only";
import {
  and,
  calendarEvents,
  cashflowPlans,
  creditCards,
  eq,
  gte,
  householdTimezone,
  lte,
  netWorthInputs,
  transactions,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import {
  addMonths,
  buildMonthEntries,
  eventsInMonth,
  groupCalendarItems,
  isYearMonth,
  lowestBalance,
  money,
  monthBounds,
  monthCells,
  projectDailyBalance,
  summarizeMonth,
  toDbAmount,
  todayIn,
  yearMonthOf,
} from "@organizeup/domain";
import { loadCommitments } from "./commitments";

/** Até onde o saldo previsto faz sentido: depois disso, são só as contas fixas somadas. */
const MAX_PROJECTION_MONTHS = 24;

export async function loadCalendar(ctx: TenantContext, requested?: string | null) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const current = yearMonthOf(today);
    const month = requested && isYearMonth(requested) ? requested : current;
    const cells = monthCells(month);

    const projects = month >= current && month <= addMonths(current, MAX_PROJECTION_MONTHS);
    const firstMonth = month < current ? month : addMonths(current, -1);
    const planRows = await tx.select().from(cashflowPlans);
    const transactionRows = await tx
      .select()
      .from(transactions)
      .where(
        and(
          gte(transactions.occurredOn, monthBounds(firstMonth).first),
          lte(transactions.occurredOn, monthBounds(month).last),
        ),
      );
    const { scheduled } = await loadCommitments(tx, { from: firstMonth, to: month });
    const entriesOf = (ym: string) =>
      buildMonthEntries(
        ym,
        planRows,
        transactionRows.filter((t) => yearMonthOf(t.occurredOn) === ym),
        scheduled,
      );

    const entries = entriesOf(month);
    const eventRows = await tx.select().from(calendarEvents);
    const cards = await tx
      .select({ id: creditCards.id, name: creditCards.name, closingDay: creditCards.closingDay })
      .from(creditCards)
      .where(eq(creditCards.archived, false));

    let balances: Record<string, string> = {};
    if (projects) {
      const pending = [];
      for (let ym = firstMonth; ym <= month; ym = addMonths(ym, 1)) {
        pending.push(...entriesOf(ym).filter((entry) => entry.status === "previsto"));
      }
      const { accounts } = await netWorthInputs(tx);
      const total = accounts
        .filter((account) => !account.archived)
        .reduce((acc, account) => acc.plus(account.balance), money(0));
      balances = projectDailyBalance(toDbAmount(total), today, pending, cells.days);
    }

    return {
      month,
      current,
      today,
      cells,
      items: groupCalendarItems(entries, eventsInMonth(eventRows, month), cards, month),
      balances,
      summary: summarizeMonth(entries),
      lowest: lowestBalance(balances),
      closing: balances[cells.days.at(-1)!] ?? null,
    };
  });
}
