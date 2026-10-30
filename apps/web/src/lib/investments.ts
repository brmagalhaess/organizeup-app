import "server-only";
import {
  asc,
  desc,
  dividendGoals,
  dividends,
  householdTimezone,
  investments,
  investmentTargets,
  investmentTrades,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import {
  money,
  summarizeDividends,
  summarizePortfolio,
  todayIn,
  yearMonthOf,
} from "@organizeup/domain";

/** Carteira com posição, valor e comparação com as metas por classe. */
export async function loadPortfolio(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const [holdings, trades, targets, paid] = await Promise.all([
      tx.select().from(investments).orderBy(asc(investments.createdAt)),
      tx.select().from(investmentTrades).orderBy(desc(investmentTrades.occurredOn)),
      tx.select().from(investmentTargets),
      tx.select().from(dividends),
    ]);
    const list = holdings.map((holding) => ({
      ...holding,
      trades: trades.filter((trade) => trade.investmentId === holding.id),
    }));
    const summary = summarizePortfolio(list, targets);
    const received = summarizeDividends(paid, yearMonthOf(today), null);
    return {
      today,
      summary,
      targets,
      dividends12: received.last12,
      rows: list.map((holding, index) => ({ ...holding, ...summary.rows[index]! })),
    };
  });
}

/** Proventos dos últimos 12 meses, com o que cada investimento rendeu sobre o custo. */
export async function loadDividends(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const [holdings, trades, rows, [goal]] = await Promise.all([
      tx.select().from(investments).orderBy(asc(investments.name)),
      tx.select().from(investmentTrades),
      tx.select().from(dividends).orderBy(desc(dividends.paidOn), desc(dividends.createdAt)),
      tx.select().from(dividendGoals),
    ]);
    const summary = summarizeDividends(rows, yearMonthOf(today), goal?.monthlyAmount ?? null);
    const nameOf = new Map(holdings.map((h) => [h.id, h.ticker ?? h.name]));
    const portfolio = summarizePortfolio(
      holdings.map((holding) => ({
        ...holding,
        trades: trades.filter((trade) => trade.investmentId === holding.id),
      })),
    );
    const costOf = new Map(portfolio.rows.map((row) => [row.id, row.position.cost]));
    return {
      today,
      summary,
      goal: goal?.monthlyAmount ?? null,
      investments: holdings.map((h) => ({ id: h.id, label: h.ticker ?? h.name })),
      rows: rows.slice(0, 60).map((row) => ({ ...row, label: nameOf.get(row.investmentId) ?? "" })),
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
