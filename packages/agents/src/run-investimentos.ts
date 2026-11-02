// Agente diário de investimentos (ADR-0015 e ADR-0017). Aplica eventos em ações, cotações e proventos
// que o job de mercado deixou nas tabelas globais, resume carteira e proventos, prevê proventos pelo
// histórico e avisa de preço velho e de classe longe da meta. Nunca indica o que comprar ou vender.
import {
  and,
  asc,
  dividends,
  eq,
  householdCurrency,
  householdSuggestions,
  inArray,
  investments,
  investmentTargets,
  investmentTrades,
  loadStockEvents,
  marketQuotes,
  ne,
  sql,
  type TenantTx,
} from "@organizeup/db";
import {
  brazilRulesApply,
  forecastDividends,
  isUnitPriced,
  marketDateOf,
  money,
  normalizeTicker,
  receivedDividends,
  summarizeDividends,
  summarizePortfolio,
  toDbAmount,
  upcomingDividends,
  yearMonthOf,
  netDividend,
} from "@organizeup/domain";
import { applyStockEvents, noMarketData, noStockEvents, syncMarketData } from "./market-sync";
import type { ReportInvestimentos } from "./reports";
import { DEDUPE, type LinkPayload } from "./suggestions";
import {
  ASSET_CLASS_LABELS,
  daysBetween,
  INVESTIMENTOS_AGENT,
  loadDecisions,
  saveDailyReport,
  STALE_PRICE_DAYS,
  upsertPending,
  type AgentInput,
  type AgentResult,
  type PendingSuggestion,
} from "./shared";
import {
  classeForaDaMetaText,
  investimentosReportText,
  proventosConferirText,
  quantidadeConferirText,
  valorAntigoText,
  valorSemInformarText,
} from "./texts";

export { INVESTIMENTOS_AGENT };
/** Diferença entre a fatia real e a meta de uma classe (pontos percentuais) que vira aviso. */
export const CLASS_DEVIATION_POINTS = 10;

export async function runInvestimentosAgent(tx: TenantTx, input: AgentInput): Promise<AgentResult> {
  const { today, householdId } = input;
  const month = yearMonthOf(today);
  // Primeiro os eventos em ações, porque a quantidade decide o valor dos proventos. Depois o mercado:
  // o resumo abaixo já sai com o preço e os proventos de hoje.
  // Fora das regras brasileiras não há B3: nem cotação, nem evento, nem provento automático.
  const currency = await householdCurrency(tx);
  const brazil = brazilRulesApply(currency);
  const stock = brazil ? await applyStockEvents(tx, input) : noStockEvents();
  const market = brazil ? await syncMarketData(tx, input) : noMarketData();
  const stockEvents = await loadStockEvents(tx);
  const [holdings, trades, targets, allDividends, quotes] = await Promise.all([
    tx.select().from(investments).orderBy(asc(investments.createdAt)),
    tx.select().from(investmentTrades),
    tx.select().from(investmentTargets),
    tx.select().from(dividends),
    tx.select().from(marketQuotes),
  ]);
  // "A receber" fica fora de toda soma até a data do pagamento.
  const paid = receivedDividends(allDividends, today);
  const upcoming = upcomingDividends(allDividends, today);
  const quoteOf = new Map(quotes.map((quote) => [quote.ticker, quote]));
  const summary = summarizePortfolio(
    holdings.map((holding) => ({
      ...holding,
      trades: trades.filter((trade) => trade.investmentId === holding.id),
      events: stockEvents.filter((event) => event.investmentId === holding.id),
    })),
    targets,
  );
  const received = summarizeDividends(paid, month, null);
  const pending: PendingSuggestion[] = [];
  const notices: PendingSuggestion[] = [];

  // Preço velho: só para quem tem posição e não recebe cotação automática recente. Sem preço nunca
  // informado também conta. Cotação parada há muito tempo volta a pedir o valor.
  const stale: string[] = [];
  const automatic: string[] = [];
  holdings.forEach((holding, index) => {
    const row = summary.rows[index]!;
    if (money(row.position.quantity).lte(0) && money(row.value).lte(0)) return;
    const ticker = isUnitPriced(holding.assetClass) ? normalizeTicker(holding.ticker) : null;
    const quote = ticker ? quoteOf.get(ticker) : undefined;
    if (quote && daysBetween(marketDateOf(quote.quotedAt), today) <= STALE_PRICE_DAYS) {
      automatic.push(holding.id);
      const event = stock.unapplied.get(holding.id);
      if (event) {
        const payload: LinkPayload = { href: "/app/investimentos", investmentId: holding.id };
        notices.push({
          kind: "investimento",
          ...quantidadeConferirText({ ticker: ticker!, note: event.note, comDate: event.comDate }),
          payload,
          dedupeKey: DEDUPE.investimentoEvento(holding.id, event.comDate),
        });
      }
      return;
    }
    const age = holding.valuedOn ? daysBetween(holding.valuedOn, today) : null;
    if (age !== null && age <= STALE_PRICE_DAYS) return;
    stale.push(holding.id);
    const label = holding.ticker ?? holding.name;
    const payload: LinkPayload = { href: "/app/investimentos", investmentId: holding.id };
    pending.push({
      kind: "investimento",
      ...(age === null ? valorSemInformarText(label) : valorAntigoText(label, age)),
      payload,
      dedupeKey: DEDUPE.investimentoPreco(holding.id, month),
    });
  });

  // Classe longe da meta: aviso informativo, sem ativo para comprar ou vender (ADR-0012).
  for (const share of summary.classes) {
    if (share.target === null || money(summary.total).lte(0)) continue;
    if (Math.abs(share.percent - share.target) < CLASS_DEVIATION_POINTS) continue;
    const label = ASSET_CLASS_LABELS[share.assetClass] ?? share.assetClass;
    const payload: LinkPayload = { href: "/app/investimentos" };
    pending.push({
      kind: "investimento",
      ...classeForaDaMetaText({
        assetClass: share.assetClass,
        label,
        percent: share.percent,
        target: share.target,
      }),
      payload,
      dedupeKey: DEDUPE.investimentoClasse(share.assetClass, month),
    });
  }

  if (market.skippedTax.length > 0) {
    const tickers = [...new Set(market.skippedTax)];
    const payload: LinkPayload = { href: "/app/proventos" };
    pending.push({
      kind: "investimento",
      ...proventosConferirText(tickers),
      payload,
      dedupeKey: DEDUPE.investimentoConferir(month),
    });
  }

  // Quem passou a ter cotação automática não precisa mais do aviso que estava na fila.
  if (automatic.length > 0) {
    await tx.delete(householdSuggestions).where(
      and(
        eq(householdSuggestions.status, "pendente"),
        inArray(
          householdSuggestions.dedupeKey,
          automatic.map((id) => DEDUPE.investimentoPreco(id, month)),
        ),
      ),
    );
  }

  // Aviso de evento em ações sai uma vez só, seja qual for a decisão da família.
  const seen = new Set(
    (
      await tx
        .select({ dedupeKey: householdSuggestions.dedupeKey })
        .from(householdSuggestions)
        .where(
          and(
            ne(householdSuggestions.status, "pendente"),
            sql`${householdSuggestions.dedupeKey} like 'investimento:evento:%'`,
          ),
        )
    ).map((row) => row.dedupeKey),
  );
  pending.push(...notices.filter((notice) => !seen.has(notice.dedupeKey)));

  const decisions = await loadDecisions(tx, today, INVESTIMENTOS_AGENT);
  const suggestions = await upsertPending(tx, householdId, INVESTIMENTOS_AGENT, decisions, pending);

  const forecastRows = forecastDividends(paid, month, 12);
  const byForecastMonth = new Map<string, ReturnType<typeof money>>();
  for (const row of forecastRows) {
    byForecastMonth.set(row.month, (byForecastMonth.get(row.month) ?? money(0)).plus(row.amount));
  }
  const forecast = [...byForecastMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([m, amount]) => ({ month: m, amount: toDbAmount(amount) }));
  const total = money(summary.total);
  const data: ReportInvestimentos = {
    total: summary.total,
    cost: summary.cost,
    yield12: total.gt(0)
      ? money(received.last12).dividedBy(total).times(100).toDecimalPlaces(1).toNumber()
      : null,
    dividends12: received.last12,
    byMonth: received.months,
    stale,
    forecast,
    market: {
      prices: market.changes.prices.length,
      created: market.created,
      adjusted: market.changes.adjusted.length,
      removed: market.changes.removed.length,
      skippedFamily: market.skippedFamily,
      skippedTax: market.skippedTax.length,
      stockEvents: stock.applied,
    },
    upcomingNet: toDbAmount(upcoming.reduce((acc, row) => acc.plus(netDividend(row)), money(0))),
  };
  const report = {
    ...investimentosReportText({
      day: today,
      empty: holdings.length === 0,
      total: summary.total,
      dividends12: received.last12,
      yield12: data.yield12,
      stale: stale.length,
      applied: market.applied,
      prices: market.changes.prices.length,
      created: market.created,
      stockEvents: stock.applied,
      upcoming: upcoming.length,
      upcomingNet: data.upcomingNet,
      next: forecast.find((item) => item.month > month) ?? null,
      currency,
    }),
    data,
  };
  await saveDailyReport(tx, householdId, INVESTIMENTOS_AGENT, "investimentos", today, report);
  return { suggestions, applied: market.applied + stock.applied, report };
}
