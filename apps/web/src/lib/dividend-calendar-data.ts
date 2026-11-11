// Dados do calendário de dividendos: o universo coletado pelo worker mais o que a família tem.
import {
  asc,
  householdTimezone,
  investmentTrades,
  investments,
  listMarketDividendsBetween,
  loadStockEvents,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import {
  entitledQuantity,
  money,
  monthBounds,
  normalizeTicker,
  toDbAmount,
  todayIn,
  type YearMonth,
} from "@organizeup/domain";
import type { CalendarEvent } from "./dividend-calendar";

export async function loadDividendCalendar(
  ctx: TenantContext,
  month: YearMonth,
  mineOnly: boolean,
) {
  const { first, last } = monthBounds(month);
  const family = await withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const [holdings, trades, events] = await Promise.all([
      tx.select().from(investments).orderBy(asc(investments.createdAt)),
      tx.select().from(investmentTrades),
      loadStockEvents(tx),
    ]);
    return { today, holdings, trades, events };
  });
  const byTicker = new Map<string, (typeof family.holdings)[number]>();
  for (const holding of family.holdings) {
    const ticker = normalizeTicker(holding.ticker);
    if (ticker) byTicker.set(ticker, holding);
  }
  // Tabelas globais, fora da transação da família (ADR-0017).
  const rows = await listMarketDividendsBetween(first, last);
  const events: CalendarEvent[] = rows.map((row) => {
    const holding = byTicker.get(row.ticker);
    if (!holding) return { ...row, mine: false, quantity: null, amount: null };
    const quantity = entitledQuantity(
      family.trades.filter((trade) => trade.investmentId === holding.id),
      row.comDate,
      family.events.filter((event) => event.investmentId === holding.id),
    );
    const held = money(quantity).gt(0);
    return {
      ...row,
      mine: true,
      quantity: held ? quantity : null,
      amount: held ? toDbAmount(money(quantity).times(row.ratePerShare)) : null,
    };
  });
  const listed = mineOnly ? events.filter((event) => event.mine) : events;
  const mineTotal = toDbAmount(
    events
      .filter((event) => event.amount && event.payDate.startsWith(month))
      .reduce((acc, event) => acc.plus(event.amount!), money(0)),
  );
  return {
    month,
    today: family.today,
    mineOnly,
    events: listed,
    total: events.length,
    mineCount: events.filter((event) => event.mine).length,
    mineTotal,
    hasHoldings: byTicker.size > 0,
  };
}
