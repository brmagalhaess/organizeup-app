// Mês do calendário com saldo previsto, compartilhado pela tela e pelo assistente.
// Rode dentro de withHousehold.
import {
  and,
  calendarEvents,
  cashflowPlans,
  creditCards,
  eq,
  gte,
  lte,
  netWorthInputs,
  transactions,
  trips,
  type TenantTx,
} from "@organizeup/db";
import {
  addMonths,
  buildMonthEntries,
  eventsInMonth,
  groupCalendarItems,
  lowestBalance,
  money,
  monthBounds,
  monthCells,
  projectDailyBalance,
  splitCardSavings,
  summarizeMonth,
  toDbAmount,
  yearMonthOf,
  type FxTotalNote,
  type YearMonth,
} from "@organizeup/domain";
import { calendarItemType, type CalendarItemType } from "./calendar-types";
import { loadCommitments, systemCategories } from "./commitments";
import { loadSavingsRule } from "./inputs";

/** Até onde o saldo previsto faz sentido: depois disso, são só as contas fixas somadas. */
const MAX_PROJECTION_MONTHS = 24;

export async function calendarMonth(tx: TenantTx, input: { today: string; month: YearMonth }) {
  const { today, month } = input;
  const current = yearMonthOf(today);
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
  const { scheduled, cardLines, cardCategoryId } = await loadCommitments(tx, {
    from: firstMonth,
    to: month,
  });
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
  let fx: FxTotalNote | null = null;
  if (projects) {
    const pending = [];
    for (let ym = firstMonth; ym <= month; ym = addMonths(ym, 1)) {
      pending.push(...entriesOf(ym).filter((entry) => entry.status === "previsto"));
    }
    const worth = await netWorthInputs(tx);
    fx = worth.fx;
    const total = worth.accounts
      .filter((account) => !account.archived)
      .reduce((acc, account) => acc.plus(account.balance), money(0));
    balances = projectDailyBalance(toDbAmount(total), today, pending, cells.days);
  }

  const items = groupCalendarItems(entries, eventsInMonth(eventRows, month), cards, month);
  const system = await systemCategories(tx);
  const rule = await loadSavingsRule(tx);
  // Só a categoria diz que "Aporte em X" foi o sistema que escreveu.
  const contributions = entries
    .filter((entry) => system.contribution && entry.categoryId === system.contribution)
    .map((entry) => entry.key);
  const tripRows = await tx.select({ eventId: trips.calendarEventId }).from(trips);
  const typeContext = {
    categoryOf: new Map(entries.map((entry) => [entry.key, entry.categoryId])),
    system,
    tripEvents: new Set(tripRows.flatMap((trip) => (trip.eventId ? [trip.eventId] : []))),
  };
  const types: Record<string, CalendarItemType> = {};
  for (const item of Object.values(items).flat())
    types[item.key] = calendarItemType(item, typeContext);

  return {
    month,
    current,
    today,
    cells,
    items,
    types,
    contributions,
    balances,
    fx,
    summary: summarizeMonth(
      splitCardSavings(
        entries,
        cardLines.filter((line) => line.statementMonth === month),
        cardCategoryId,
        rule,
      ),
      rule,
    ),
    lowest: lowestBalance(balances),
    closing: balances[cells.days.at(-1)!] ?? null,
  };
}
