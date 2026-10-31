// Agente diário de investimentos (ADR-0015 e ADR-0017). Aplica cotações e proventos que o job de
// mercado deixou nas tabelas globais, resume carteira e proventos, prevê proventos pelo histórico e
// avisa de preço velho e de classe longe da meta. Nunca indica o que comprar ou vender.
import {
  and,
  asc,
  dividends,
  eq,
  householdSuggestions,
  inArray,
  investments,
  investmentTargets,
  investmentTrades,
  marketQuotes,
  ne,
  sql,
  type TenantTx,
} from "@organizeup/db";
import {
  forecastDividends,
  formatBRL,
  formatYearMonth,
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
import { syncMarketData } from "./market-sync";
import type { ReportInvestimentos } from "./reports";
import { DEDUPE, type LinkPayload } from "./suggestions";
import {
  ASSET_CLASS_LABELS,
  daysBetween,
  INVESTIMENTOS_AGENT,
  loadDecisions,
  plural,
  saveDailyReport,
  STALE_PRICE_DAYS,
  upsertPending,
  type AgentInput,
  type AgentResult,
  type PendingSuggestion,
} from "./shared";

export { INVESTIMENTOS_AGENT };
/** Diferença entre a fatia real e a meta de uma classe (pontos percentuais) que vira aviso. */
export const CLASS_DEVIATION_POINTS = 10;

export async function runInvestimentosAgent(tx: TenantTx, input: AgentInput): Promise<AgentResult> {
  const { today, householdId } = input;
  const month = yearMonthOf(today);
  // Primeiro o mercado: o resumo abaixo já sai com o preço e os proventos de hoje.
  const market = await syncMarketData(tx, input);
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
      const event = quote.lastStockEventOn;
      const own = trades.filter((trade) => trade.investmentId === holding.id);
      if (event && own.some((trade) => trade.occurredOn <= event)) {
        const payload: LinkPayload = { href: "/app/investimentos", investmentId: holding.id };
        notices.push({
          kind: "investimento",
          title: `Confira a quantidade de ${ticker}`,
          body:
            `${quote.lastStockEventNote ?? "Evento em ações"} com data-com em ` +
            `${event.split("-").reverse().join("/")}. O sistema não ajusta a quantidade sozinho: ` +
            `até você corrigir as operações, o valor deste investimento pode ficar errado.`,
          payload,
          dedupeKey: DEDUPE.investimentoEvento(holding.id, event),
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
      title: `Atualize o valor de ${label}`,
      body:
        age === null
          ? `${label} ainda não tem valor atual informado; o patrimônio e o plano usam o custo de compra.`
          : `O último valor de ${label} é de há ${plural(age, "dia", "dias")}. Sem um valor recente, ` +
            `o patrimônio e o plano de aposentadoria ficam defasados.`,
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
      title: `${label}: ${share.percent}% da carteira, meta de ${share.target}%`,
      body:
        `A fatia de ${label.toLowerCase()} está ${share.percent > share.target ? "acima" : "abaixo"} ` +
        `da meta que você definiu. É só um aviso: o assistente não indica o que comprar ou vender.`,
      payload,
      dedupeKey: DEDUPE.investimentoClasse(share.assetClass, month),
    });
  }

  if (market.skippedTax.length > 0) {
    const tickers = [...new Set(market.skippedTax)];
    const payload: LinkPayload = { href: "/app/proventos" };
    pending.push({
      kind: "investimento",
      title: "Proventos para conferir no extrato",
      body:
        `${tickers.join(", ")}: há proventos que não lançamos sozinhos porque o imposto depende de ` +
        `dados que não temos, como a data do crédito ou o titular. Confira no extrato e lance em ` +
        `Proventos.`,
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
    },
    upcomingNet: toDbAmount(upcoming.reduce((acc, row) => acc.plus(netDividend(row)), money(0))),
  };
  const nextForecast = forecast.find((item) => item.month > month);
  const summaryText =
    holdings.length === 0
      ? "Nenhum investimento cadastrado ainda."
      : `Carteira de ${formatBRL(summary.total)}; ${formatBRL(received.last12)} em proventos nos ` +
        `últimos 12 meses${data.yield12 !== null ? ` (${data.yield12}% ao ano)` : ""}. ` +
        `${plural(stale.length, "investimento", "investimentos")} com valor para atualizar.` +
        (market.applied > 0
          ? ` Atualizado sozinho hoje: ${plural(market.changes.prices.length, "preço", "preços")} ` +
            `e ${plural(market.created, "provento novo", "proventos novos")}.`
          : "") +
        (upcoming.length > 0 ? ` A receber: ${formatBRL(data.upcomingNet)}.` : "") +
        (nextForecast
          ? ` Previsão para ${formatYearMonth(nextForecast.month)}: ${formatBRL(nextForecast.amount)} em proventos.`
          : "");
  const report = {
    title: `Investimentos em ${today}`,
    summary: summaryText,
    data,
  };
  await saveDailyReport(tx, householdId, INVESTIMENTOS_AGENT, "investimentos", today, report);
  return { suggestions, applied: market.applied, report };
}
