// Agente diário de investimentos (ADR-0015). Resume carteira e proventos, prevê proventos pelo
// histórico e avisa de preço velho e de classe longe da meta. Nunca indica o que comprar ou vender.
import {
  asc,
  dividends,
  investments,
  investmentTargets,
  investmentTrades,
  type TenantTx,
} from "@organizeup/db";
import {
  forecastDividends,
  formatBRL,
  formatYearMonth,
  money,
  summarizeDividends,
  summarizePortfolio,
  toDbAmount,
  yearMonthOf,
} from "@organizeup/domain";
import type { ReportInvestimentos } from "./reports";
import { DEDUPE, type LinkPayload } from "./suggestions";
import {
  ASSET_CLASS_LABELS,
  daysBetween,
  loadDecisions,
  plural,
  saveDailyReport,
  STALE_PRICE_DAYS,
  upsertPending,
  type AgentInput,
  type AgentResult,
  type PendingSuggestion,
} from "./shared";

export const INVESTIMENTOS_AGENT = "investimentos";
/** Diferença entre a fatia real e a meta de uma classe (pontos percentuais) que vira aviso. */
export const CLASS_DEVIATION_POINTS = 10;

export async function runInvestimentosAgent(tx: TenantTx, input: AgentInput): Promise<AgentResult> {
  const { today, householdId } = input;
  const month = yearMonthOf(today);
  const [holdings, trades, targets, paid] = await Promise.all([
    tx.select().from(investments).orderBy(asc(investments.createdAt)),
    tx.select().from(investmentTrades),
    tx.select().from(investmentTargets),
    tx.select().from(dividends),
  ]);
  const summary = summarizePortfolio(
    holdings.map((holding) => ({
      ...holding,
      trades: trades.filter((trade) => trade.investmentId === holding.id),
    })),
    targets,
  );
  const received = summarizeDividends(paid, month, null);
  const pending: PendingSuggestion[] = [];

  // Preço velho: só para quem tem posição. Sem preço nunca informado também conta.
  const stale: string[] = [];
  holdings.forEach((holding, index) => {
    const row = summary.rows[index]!;
    if (money(row.position.quantity).lte(0) && money(row.value).lte(0)) return;
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
  };
  const nextForecast = forecast.find((item) => item.month > month);
  const summaryText =
    holdings.length === 0
      ? "Nenhum investimento cadastrado ainda."
      : `Carteira de ${formatBRL(summary.total)}; ${formatBRL(received.last12)} em proventos nos ` +
        `últimos 12 meses${data.yield12 !== null ? ` (${data.yield12}% ao ano)` : ""}. ` +
        `${plural(stale.length, "investimento", "investimentos")} com valor para atualizar.` +
        (nextForecast
          ? ` Previsão para ${formatYearMonth(nextForecast.month)}: ${formatBRL(nextForecast.amount)} em proventos.`
          : "");
  const report = {
    title: `Investimentos em ${today}`,
    summary: summaryText,
    data,
  };
  await saveDailyReport(tx, householdId, INVESTIMENTOS_AGENT, "investimentos", today, report);
  return { suggestions, applied: 0, report };
}
