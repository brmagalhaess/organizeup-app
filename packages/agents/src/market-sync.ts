// Leva cotações e proventos das tabelas globais para a carteira de uma família (ADR-0017). Roda dentro
// do tx do agente de investimentos e só lê tabelas globais, sem chamada externa. As contas ficam em
// @organizeup/domain. Toda mudança entra numa única sugestão `aplicada` por dia, com Desfazer.
import {
  and,
  dividends,
  eq,
  householdSuggestions,
  inArray,
  investments,
  investmentTrades,
  marketDividends,
  marketQuotes,
  sql,
  type TenantTx,
} from "@organizeup/db";
import {
  formatBRL,
  marketDateOf,
  money,
  netDividend,
  normalizeTicker,
  quoteApplies,
  reconcileProventos,
  toDbAmount,
} from "@organizeup/domain";
import { clamp, INVESTIMENTOS_AGENT, MAX_BODY, MAX_TITLE, plural, recordApplied } from "./shared";
import {
  DEDUPE,
  MARKET_DEDUPE_PREFIX,
  marketChangesSchema,
  type MarketChanges,
} from "./suggestions";

const emptyChanges = (): MarketChanges => ({ prices: [], created: [], adjusted: [], removed: [] });

interface Blocks {
  /** `investimento:cotação` já desfeita. */
  prices: Set<string>;
  /** Proventos de mercado desfeitos ou excluídos, por investimento. */
  proventos: Map<string, Set<string>>;
}

const priceKey = (investmentId: string, quoteDate: string) => `${investmentId}:${quoteDate}`;

/** O que a família desfez ou excluiu. Fica nas linhas `desfeita`, para sempre. */
async function loadBlocks(tx: TenantTx): Promise<Blocks> {
  const rows = await tx
    .select({ payload: householdSuggestions.payload })
    .from(householdSuggestions)
    .where(
      and(
        eq(householdSuggestions.status, "desfeita"),
        eq(householdSuggestions.agent, INVESTIMENTOS_AGENT),
        sql`${householdSuggestions.dedupeKey} like ${`${MARKET_DEDUPE_PREFIX}%`}`,
      ),
    );
  const blocks: Blocks = { prices: new Set(), proventos: new Map() };
  const block = (investmentId: string, marketDividendId: string) => {
    const set = blocks.proventos.get(investmentId) ?? new Set<string>();
    set.add(marketDividendId);
    blocks.proventos.set(investmentId, set);
  };
  for (const row of rows) {
    const parsed = marketChangesSchema.safeParse((row.payload as { market?: unknown }).market);
    if (!parsed.success) continue;
    for (const item of parsed.data.prices)
      blocks.prices.add(priceKey(item.investmentId, item.quoteDate));
    for (const list of [parsed.data.created, parsed.data.adjusted, parsed.data.removed])
      for (const item of list) block(item.investmentId, item.marketDividendId);
  }
  return blocks;
}

export interface MarketSyncResult {
  changes: MarketChanges;
  /** Mudanças desta rodada: preços + proventos criados, corrigidos e tirados. */
  applied: number;
  created: number;
  upcoming: number;
  upcomingNet: string;
  /** Já estavam lançados pela família. */
  skippedFamily: number;
  /** Imposto sem certeza: ficam para a família conferir no extrato. */
  skippedTax: string[];
}

/** Junta com a sugestão do dia, mantendo o estado de antes da primeira mudança de cada preço. */
function mergeChanges(before: MarketChanges, next: MarketChanges): MarketChanges {
  const prices = [...before.prices];
  for (const change of next.prices) {
    const index = prices.findIndex((item) => item.investmentId === change.investmentId);
    if (index >= 0) prices[index] = { ...change, previous: prices[index]!.previous };
    else prices.push(change);
  }
  return {
    prices,
    created: [...before.created, ...next.created],
    adjusted: [...before.adjusted, ...next.adjusted],
    removed: [...before.removed, ...next.removed],
  };
}

async function saveDailyChange(
  tx: TenantTx,
  householdId: string,
  today: string,
  next: MarketChanges,
  text: { title: string; body: string },
): Promise<void> {
  const dedupeKey = DEDUPE.mercadoDia(today);
  const [existing] = await tx
    .select({ id: householdSuggestions.id, payload: householdSuggestions.payload })
    .from(householdSuggestions)
    .where(
      and(
        eq(householdSuggestions.dedupeKey, dedupeKey),
        eq(householdSuggestions.status, "aplicada"),
      ),
    );
  if (!existing) {
    await recordApplied(tx, householdId, INVESTIMENTOS_AGENT, {
      kind: "investimento",
      ...text,
      payload: { href: "/app/investimentos", market: next },
      dedupeKey,
    });
    return;
  }
  const parsed = marketChangesSchema.safeParse((existing.payload as { market?: unknown }).market);
  const market = mergeChanges(parsed.success ? parsed.data : emptyChanges(), next);
  await tx
    .update(householdSuggestions)
    .set({
      title: clamp(text.title, MAX_TITLE),
      body: clamp(text.body, MAX_BODY),
      payload: { href: "/app/investimentos", market },
    })
    .where(eq(householdSuggestions.id, existing.id));
}

export async function syncMarketData(
  tx: TenantTx,
  input: { today: string; householdId: string },
): Promise<MarketSyncResult> {
  const { today, householdId } = input;
  const result: MarketSyncResult = {
    changes: emptyChanges(),
    applied: 0,
    created: 0,
    upcoming: 0,
    upcomingNet: "0.00",
    skippedFamily: 0,
    skippedTax: [],
  };
  const holdings = await tx.select().from(investments);
  const eligible = holdings.flatMap((holding) => {
    const ticker =
      holding.assetClass === "acao" ||
      holding.assetClass === "fii" ||
      holding.assetClass === "etf_bdr"
        ? normalizeTicker(holding.ticker)
        : null;
    return ticker ? [{ ...holding, marketTicker: ticker }] : [];
  });
  if (eligible.length === 0) return result;

  const tickers = [...new Set(eligible.map((holding) => holding.marketTicker))];
  const [quotes, events, trades, recorded, blocks] = await Promise.all([
    tx.select().from(marketQuotes).where(inArray(marketQuotes.ticker, tickers)),
    tx.select().from(marketDividends).where(inArray(marketDividends.ticker, tickers)),
    tx.select().from(investmentTrades),
    tx.select().from(dividends),
    loadBlocks(tx),
  ]);
  const quoteOf = new Map(quotes.map((quote) => [quote.ticker, quote]));
  const changes = result.changes;
  const labels: string[] = [];
  let upcomingNet = money(0);

  for (const holding of eligible) {
    const quote = quoteOf.get(holding.marketTicker);
    if (quote) {
      const quoteDate = marketDateOf(quote.quotedAt);
      const applies =
        !blocks.prices.has(priceKey(holding.id, quoteDate)) &&
        quoteApplies({
          priceSource: holding.priceSource,
          currentPrice: holding.currentPrice,
          valuedOn: holding.valuedOn,
          quotePrice: quote.price,
          quoteDate,
        });
      if (applies) {
        await tx
          .update(investments)
          .set({ currentPrice: quote.price, valuedOn: quoteDate, priceSource: "mercado" })
          .where(eq(investments.id, holding.id));
        changes.prices.push({
          investmentId: holding.id,
          quoteDate,
          price: quote.price,
          previous: {
            price: holding.currentPrice,
            valuedOn: holding.valuedOn,
            source: holding.priceSource,
          },
        });
        labels.push(holding.marketTicker);
      }
    }

    const existing = recorded.filter((row) => row.investmentId === holding.id);
    const plan = reconcileProventos({
      assetClass: holding.assetClass,
      trades: trades.filter((trade) => trade.investmentId === holding.id),
      events: events.filter((event) => event.ticker === holding.marketTicker),
      existing,
      blocked: blocks.proventos.get(holding.id) ?? new Set(),
    });
    result.skippedFamily += plan.skippedFamily;
    if (plan.skippedTax > 0) result.skippedTax.push(holding.marketTicker);

    for (const entry of plan.create) {
      const [row] = await tx
        .insert(dividends)
        .values({ householdId, investmentId: holding.id, source: "agente", ...entry })
        .onConflictDoNothing()
        .returning({ id: dividends.id });
      if (!row) continue;
      result.created += 1;
      changes.created.push({
        dividendId: row.id,
        investmentId: holding.id,
        marketDividendId: entry.marketDividendId,
      });
      if (entry.paidOn > today) {
        result.upcoming += 1;
        upcomingNet = upcomingNet.plus(netDividend(entry));
      }
    }
    for (const { id, marketDividendId, gross, withheld } of plan.update) {
      const previous = existing.find((row) => row.id === id)!;
      await tx.update(dividends).set({ gross, withheld }).where(eq(dividends.id, id));
      changes.adjusted.push({
        dividendId: id,
        investmentId: holding.id,
        marketDividendId,
        gross,
        withheld,
        previous: { gross: previous.gross, withheld: previous.withheld },
      });
    }
    for (const row of plan.remove) {
      await tx.delete(dividends).where(eq(dividends.id, row.id));
      changes.removed.push({
        investmentId: holding.id,
        marketDividendId: row.marketDividendId!,
        kind: row.kind,
        paidOn: row.paidOn,
        gross: row.gross,
        withheld: row.withheld,
      });
    }
  }

  result.upcomingNet = toDbAmount(upcomingNet);
  result.applied =
    changes.prices.length +
    changes.created.length +
    changes.adjusted.length +
    changes.removed.length;
  if (result.applied === 0) return result;

  const parts = [
    changes.prices.length > 0
      ? `${plural(changes.prices.length, "preço atualizado", "preços atualizados")} (${labels.slice(0, 8).join(", ")}${labels.length > 8 ? " e outros" : ""})`
      : null,
    changes.created.length > 0
      ? plural(changes.created.length, "provento lançado", "proventos lançados")
      : null,
    result.upcoming > 0
      ? `${formatBRL(upcomingNet)} a receber em ${plural(result.upcoming, "pagamento", "pagamentos")}`
      : null,
    changes.adjusted.length > 0
      ? plural(changes.adjusted.length, "provento corrigido", "proventos corrigidos")
      : null,
    changes.removed.length > 0
      ? plural(changes.removed.length, "provento retirado", "proventos retirados")
      : null,
  ].filter((part): part is string => part !== null);
  await saveDailyChange(tx, householdId, today, changes, {
    title: "Cotações e proventos atualizados",
    body: `${parts.join("; ")}. Se desfizer, os proventos não voltam sozinhos; o preço volta com a próxima cotação nova.`,
  });
  return result;
}
