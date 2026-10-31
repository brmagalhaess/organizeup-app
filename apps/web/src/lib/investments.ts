import "server-only";
import {
  asc,
  desc,
  dividendGoals,
  dividends,
  householdTimezone,
  inArray,
  investments,
  investmentTargets,
  investmentTrades,
  marketDividends,
  marketQuotes,
  marketTickers,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import {
  marketDateOf,
  money,
  netDividend,
  normalizeTicker,
  quoteStateOf,
  receivedDividends,
  summarizeDividends,
  summarizePortfolio,
  toDbAmount,
  todayIn,
  upcomingDividends,
  yearMonthOf,
} from "@organizeup/domain";

/** Carteira com posição, valor, situação da cotação e comparação com as metas por classe. */
export async function loadPortfolio(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const [holdings, trades, targets, paid] = await Promise.all([
      tx.select().from(investments).orderBy(asc(investments.createdAt)),
      tx.select().from(investmentTrades).orderBy(desc(investmentTrades.occurredOn)),
      tx.select().from(investmentTargets),
      tx.select().from(dividends),
    ]);
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
      trades: trades.filter((trade) => trade.investmentId === holding.id),
    }));
    const summary = summarizePortfolio(list, targets);
    const received = summarizeDividends(receivedDividends(paid, today), yearMonthOf(today), null);
    return {
      today,
      summary,
      targets,
      dividends12: received.last12,
      rows: list.map((holding, index) => {
        const ticker = normalizeTicker(holding.ticker);
        const quote = ticker ? quoteOf.get(ticker) : undefined;
        return {
          ...holding,
          ...summary.rows[index]!,
          quoteState: quoteStateOf({
            assetClass: holding.assetClass,
            ticker: holding.ticker,
            priceSource: holding.priceSource,
            hasQuote: quote !== undefined,
            tickerStatus: ticker ? (statusOf.get(ticker) ?? null) : null,
          }),
          quoteDate: quote ? marketDateOf(quote.quotedAt) : null,
          quoteSource: quote?.source ?? null,
        };
      }),
    };
  });
}

/** Proventos recebidos e a receber, com o que cada investimento rendeu sobre o custo. */
export async function loadDividends(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const [holdings, trades, rows, [goal]] = await Promise.all([
      tx.select().from(investments).orderBy(asc(investments.name)),
      tx.select().from(investmentTrades),
      tx.select().from(dividends).orderBy(desc(dividends.paidOn), desc(dividends.createdAt)),
      tx.select().from(dividendGoals),
    ]);
    const received = receivedDividends(rows, today);
    const upcoming = upcomingDividends(rows, today);
    const summary = summarizeDividends(received, yearMonthOf(today), goal?.monthlyAmount ?? null);
    const nameOf = new Map(holdings.map((h) => [h.id, h.ticker ?? h.name]));
    const portfolio = summarizePortfolio(
      holdings.map((holding) => ({
        ...holding,
        trades: trades.filter((trade) => trade.investmentId === holding.id),
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
