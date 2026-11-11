import "server-only";
import {
  accounts,
  eq,
  transactions,
  asc,
  desc,
  dividendGoals,
  dividends,
  gte,
  householdTimezone,
  inArray,
  investments,
  investmentTargets,
  investmentTrades,
  loadStockEvents,
  marketDividends,
  marketQuotes,
  marketTickers,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import {
  addMonths,
  DIVIDEND_PERIODS,
  dividendMonths,
  dividendsInMonth,
  investedUntil,
  marketDateOf,
  money,
  monthBounds,
  monthPhase,
  netDividend,
  normalizeTicker,
  quoteStateOf,
  receivedDividends,
  summarizeDividends,
  summarizePortfolio,
  todayIn,
  toDbAmount,
  tradesByMonth,
  upcomingDividends,
  yearMonthOf,
  type DividendMonth,
  type DividendPeriod,
} from "@organizeup/domain";

/** Carteira com posição, valor, situação da cotação e comparação com as metas por classe. */
export async function loadPortfolio(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const events = await loadStockEvents(tx);
    const [holdings, trades, targets, paid, accountRows, moves] = await Promise.all([
      tx.select().from(investments).orderBy(asc(investments.createdAt)),
      tx.select().from(investmentTrades).orderBy(desc(investmentTrades.occurredOn)),
      tx.select().from(investmentTargets),
      tx.select().from(dividends),
      tx
        .select({ id: accounts.id, name: accounts.name, archived: accounts.archived })
        .from(accounts)
        .orderBy(asc(accounts.createdAt)),
      tx
        .select({ id: transactions.id, accountId: transactions.accountId })
        .from(transactions)
        .innerJoin(investmentTrades, eq(investmentTrades.transactionId, transactions.id)),
    ]);
    const nameOf = new Map(accountRows.map((row) => [row.id, row.name]));
    const accountOf = new Map(moves.map((row) => [row.id, nameOf.get(row.accountId) ?? null]));
    const accountIdOf = new Map(moves.map((row) => [row.id, row.accountId]));
    const tickers = [
      ...new Set(holdings.flatMap((holding) => normalizeTicker(holding.ticker) ?? [])),
    ];
    const [quotes, statuses] =
      tickers.length === 0
        ? [[], []]
        : await Promise.all([
            tx.select().from(marketQuotes).where(inArray(marketQuotes.ticker, tickers)),
            tx.select().from(marketTickers).where(inArray(marketTickers.ticker, tickers)),
          ]);
    const quoteOf = new Map(quotes.map((quote) => [quote.ticker, quote]));
    const statusOf = new Map(statuses.map((row) => [row.ticker, row.status]));

    const list = holdings.map((holding) => ({
      ...holding,
      trades: trades
        .filter((trade) => trade.investmentId === holding.id)
        .map((trade) => ({
          ...trade,
          accountName: trade.transactionId ? (accountOf.get(trade.transactionId) ?? null) : null,
          accountId: trade.transactionId ? (accountIdOf.get(trade.transactionId) ?? null) : null,
        })),
      events: events.filter((event) => event.investmentId === holding.id),
    }));
    const summary = summarizePortfolio(list, targets);
    const received = summarizeDividends(receivedDividends(paid, today), yearMonthOf(today), null);
    const dividends12Of = new Map(
      received.byInvestment.map((item) => [item.investmentId, item.net]),
    );
    const upcomingNet = toDbAmount(
      upcomingDividends(paid, today).reduce((acc, row) => acc.plus(netDividend(row)), money(0)),
    );
    return {
      today,
      summary,
      targets,
      accounts: accountRows.filter((row) => !row.archived),
      dividends12: received.last12,
      dividendsUpcomingNet: upcomingNet,
      rows: list.map((holding, index) => {
        const ticker = normalizeTicker(holding.ticker);
        const quote = ticker ? quoteOf.get(ticker) : undefined;
        return {
          ...holding,
          ...summary.rows[index]!,
          dividends12: dividends12Of.get(holding.id) ?? null,
          quoteState: quoteStateOf({
            assetClass: holding.assetClass,
            ticker: holding.ticker,
            priceSource: holding.priceSource,
            hasQuote: quote !== undefined,
            tickerStatus: ticker ? (statusOf.get(ticker) ?? null) : null,
          }),
          quoteDate: quote ? marketDateOf(quote.quotedAt) : null,
          quoteSource: quote?.source ?? null,
          marketBookValue: quote?.bookValuePerShare ?? null,
          marketBookValueAsOf: quote?.bookValueAsOf ?? null,
        };
      }),
    };
  });
}

/**
 * Investimentos e proventos do mês do painel. Aportes, resgates e valor aplicado até o fim do mês saem das
 * operações, que têm data. Carteira, ganho e divisão por classe são a posição de hoje: não há histórico de
 * preço. Proventos só da janela usada.
 */
export async function loadMonthInvestments(ctx: TenantContext, month: string) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const current = yearMonthOf(today);
    const events = await loadStockEvents(tx);
    const oldest = [addMonths(month, -11), addMonths(current, -12)].sort()[0]!;
    const [holdings, trades, targets, rows] = await Promise.all([
      tx.select().from(investments).orderBy(asc(investments.createdAt)),
      tx.select().from(investmentTrades),
      tx.select().from(investmentTargets),
      tx
        .select()
        .from(dividends)
        .where(gte(dividends.paidOn, `${oldest}-01`)),
    ]);
    const list = holdings.map((holding) => ({
      ...holding,
      trades: trades.filter((trade) => trade.investmentId === holding.id),
      events: events.filter((event) => event.investmentId === holding.id),
    }));
    const summary = summarizePortfolio(list, targets);
    const [moved] = tradesByMonth([month], trades);
    const phase = monthPhase(month, current);
    const nameOf = new Map(holdings.map((h) => [h.id, h.ticker ?? h.name]));
    return {
      hasInvestments: holdings.length > 0,
      hasDividends: rows.length > 0,
      past: phase === "passado",
      future: phase === "futuro",
      total: summary.total,
      cost: summary.cost,
      gain: summary.gain,
      gainPercent: summary.gainPercent,
      classes: summary.classes.filter((share) => money(share.value).gt(0)),
      /** Ativos sem preço: valem o custo. */
      estimated: summary.rows.filter((row) => row.estimated).length,
      bought: moved?.bought ?? "0.00",
      sold: moved?.sold ?? "0.00",
      /** Null fora de mês passado. */
      investedAtEnd: phase === "passado" ? investedUntil(list, monthBounds(month).last) : null,
      dividends: dividendsInMonth(rows, month, today),
      upcoming: upcomingDividends(rows, today)
        .slice(0, 3)
        .map((row) => ({
          id: row.id,
          label: nameOf.get(row.investmentId) ?? "",
          paidOn: row.paidOn,
          net: netDividend(row),
        })),
    };
  });
}

/** Proventos recebidos e a receber, com o que cada investimento rendeu sobre o custo. */
export async function loadDividends(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const events = await loadStockEvents(tx);
    const [holdings, trades, rows, [goal]] = await Promise.all([
      tx.select().from(investments).orderBy(asc(investments.name)),
      tx.select().from(investmentTrades),
      tx.select().from(dividends).orderBy(desc(dividends.paidOn), desc(dividends.createdAt)),
      tx.select().from(dividendGoals),
    ]);
    const received = receivedDividends(rows, today);
    const upcoming = upcomingDividends(rows, today);
    const summary = summarizeDividends(received, yearMonthOf(today), goal?.monthlyAmount ?? null);
    // "Desde o início" começa no mês do primeiro ativo: a primeira operação, ou o primeiro provento.
    const firstDates = [
      ...trades.map((trade) => trade.occurredOn),
      ...rows.map((row) => row.paidOn),
    ];
    const start = firstDates.length === 0 ? null : yearMonthOf(firstDates.sort()[0]!);
    const chart = Object.fromEntries(
      DIVIDEND_PERIODS.map((period) => [period, dividendMonths(rows, today, period, start)]),
    ) as Record<DividendPeriod, DividendMonth[]>;
    const nameOf = new Map(holdings.map((h) => [h.id, h.ticker ?? h.name]));
    const portfolio = summarizePortfolio(
      holdings.map((holding) => ({
        ...holding,
        trades: trades.filter((trade) => trade.investmentId === holding.id),
        events: events.filter((event) => event.investmentId === holding.id),
      })),
    );
    const costOf = new Map(portfolio.rows.map((row) => [row.id, row.position.cost]));
    const sourceIds = rows.flatMap((row) => row.marketDividendId ?? []);
    const sources =
      sourceIds.length === 0
        ? []
        : await tx
            .select({
              id: marketDividends.id,
              comDate: marketDividends.comDate,
              source: marketDividends.source,
            })
            .from(marketDividends)
            .where(inArray(marketDividends.id, sourceIds));
    const sourceOf = new Map(sources.map((source) => [source.id, source]));
    const withLabel = <T extends (typeof rows)[number]>(row: T) => ({
      ...row,
      label: nameOf.get(row.investmentId) ?? "",
      market: row.marketDividendId ? (sourceOf.get(row.marketDividendId) ?? null) : null,
    });
    return {
      today,
      summary,
      chart,
      goal: goal?.monthlyAmount ?? null,
      investments: holdings.map((h) => ({ id: h.id, label: h.ticker ?? h.name })),
      rows: received.slice(0, 60).map(withLabel),
      upcoming: upcoming.map(withLabel),
      upcomingNet: toDbAmount(upcoming.reduce((acc, row) => acc.plus(netDividend(row)), money(0))),
      byInvestment: summary.byInvestment.map((item) => {
        const cost = costOf.get(item.investmentId) ?? "0";
        return {
          ...item,
          label: nameOf.get(item.investmentId) ?? "",
          yieldOnCost: money(cost).isZero()
            ? null
            : money(item.net).dividedBy(cost).times(100).toDecimalPlaces(1).toNumber(),
        };
      }),
    };
  });
}
