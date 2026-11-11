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
  positionOf,
  toDbAmount,
  todayIn,
  type YearMonth,
} from "@organizeup/domain";
import { isMineEvent, type CalendarEvent } from "./dividend-calendar";

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
  const byTicker = new Map<
    string,
    {
      trades: typeof family.trades;
      events: typeof family.events;
      /** Quantidade hoje: zerada, o ativo já não é da carteira. */
      held: string;
    }
  >();
  for (const holding of family.holdings) {
    const ticker = normalizeTicker(holding.ticker);
    if (!ticker) continue;
    const trades = family.trades.filter((trade) => trade.investmentId === holding.id);
    const events = family.events.filter((event) => event.investmentId === holding.id);
    byTicker.set(ticker, { trades, events, held: positionOf(trades, events).quantity });
  }
  // Tabelas globais, fora da transação da família (ADR-0017).
  const rows = await listMarketDividendsBetween(first, last);
  const events: CalendarEvent[] = rows.map((row) => {
    const holding = byTicker.get(row.ticker);
    if (!holding) return { ...row, mine: false, quantity: null, amount: null };
    const quantity = entitledQuantity(holding.trades, row.comDate, holding.events);
    const mine = isMineEvent({
      held: holding.held,
      entitled: quantity,
      payDate: row.payDate,
      today: family.today,
    });
    const entitled = mine && money(quantity).gt(0);
    return {
      ...row,
      mine,
      quantity: entitled ? quantity : null,
      amount: entitled ? toDbAmount(money(quantity).times(row.ratePerShare)) : null,
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
    hasHoldings: [...byTicker.values()].some((holding) => money(holding.held).gt(0)),
  };
}
