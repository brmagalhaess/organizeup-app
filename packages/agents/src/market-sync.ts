// Leva cotações, eventos em ações e proventos das tabelas globais para a carteira de uma família
// (ADR-0017). Roda dentro do tx do agente de investimentos e só lê tabelas globais, sem chamada externa.
// As contas ficam em @organizeup/domain. Cotações e proventos entram numa única sugestão `aplicada` por
// dia; cada evento em ações, na sua. Tudo com Desfazer.
import {
  and,
  asc,
  dividends,
  eq,
  householdCurrency,
  householdSuggestions,
  inArray,
  investments,
  investmentStockEvents,
  investmentTrades,
  loadStockEvents,
  lockFamilyImport,
  marketDividends,
  marketQuotes,
  marketStockEvents,
  sql,
  type TenantTx,
} from "@organizeup/db";
import {
  entitledQuantity,
  isUnitPriced,
  marketDateOf,
  money,
  netDividend,
  normalizeTicker,
  positionOf,
  quoteApplies,
  reconcileProventos,
  toDbAmount,
} from "@organizeup/domain";
import {
  clamp,
  INVESTIMENTOS_AGENT,
  MAX_BODY,
  MAX_TITLE,
  messageColumns,
  recordApplied,
} from "./shared";
import {
  DEDUPE,
  investimentoPayloadSchema,
  MARKET_DEDUPE_PREFIX,
  marketChangesSchema,
  STOCK_EVENT_DEDUPE_PREFIX,
  type MarketChanges,
  type StockEventChange,
} from "./suggestions";
import { mercadoDiaText, quantidadeAjustadaText, type AgentText } from "./texts";

/** Só ativo cotado com código válido participa do que vem do mercado. */
const withMarketTicker = <T extends { assetClass: string; ticker: string | null }>(holdings: T[]) =>
  holdings.flatMap((holding) => {
    const marketTicker = isUnitPriced(holding.assetClass) ? normalizeTicker(holding.ticker) : null;
    return marketTicker ? [{ ...holding, marketTicker }] : [];
  });

type EventIdentity = Pick<StockEventChange, "comDate" | "factor" | "note">;

/**
 * A nota vem da fonte e pode mudar de redação depois (o fator completo aparecer, por exemplo), e o fator
 * pode ser corrigido. Nos dois casos, é o mesmo evento: aplicá-lo de novo dobraria a quantidade.
 */
const sameEvent = (a: EventIdentity, b: EventIdentity) =>
  a.comDate === b.comDate && (a.note === b.note || money(a.factor).eq(b.factor));

export interface StockEventsResult {
  /** Eventos aplicados nesta rodada. */
  applied: number;
  /** Evento mais recente que ficou só no aviso, por investimento. */
  unapplied: Map<string, { comDate: string; note: string }>;
}

/**
 * Aplica desdobramentos, grupamentos e bonificações ainda não aplicados. Só o faz sozinho quando todas
 * as operações até a data-com foram registradas antes dela: operação cadastrada depois pode já estar na
 * quantidade nova, e aí fica o aviso. Rodar de novo não muda nada, e o que a família desfez não volta.
 */
export const noStockEvents = (): StockEventsResult => ({ applied: 0, unapplied: new Map() });

export async function applyStockEvents(
  tx: TenantTx,
  input: { householdId: string },
): Promise<StockEventsResult> {
  const { householdId } = input;
  const result = noStockEvents();
  const eligible = withMarketTicker(await tx.select().from(investments));
  if (eligible.length === 0) return result;

  // Importação em andamento termina antes: esta rodada precisa enxergar o que ela gravou (ADR-0029).
  await lockFamilyImport(tx, householdId);
  const tickers = [...new Set(eligible.map((holding) => holding.marketTicker))];
  const recorded = await loadStockEvents(tx);
  const [market, trades, undoneRows] = await Promise.all([
    tx
      .select()
      .from(marketStockEvents)
      .where(inArray(marketStockEvents.ticker, tickers))
      .orderBy(asc(marketStockEvents.comDate), asc(marketStockEvents.note)),
    tx.select().from(investmentTrades),
    tx
      .select({ payload: householdSuggestions.payload })
      .from(householdSuggestions)
      .where(
        and(
          eq(householdSuggestions.status, "desfeita"),
          sql`${householdSuggestions.dedupeKey} like ${`${STOCK_EVENT_DEDUPE_PREFIX}%`}`,
        ),
      ),
  ]);
  const undone = undoneRows.flatMap((row) => {
    const parsed = investimentoPayloadSchema.safeParse(row.payload);
    return parsed.success && parsed.data.stockEvent ? [parsed.data.stockEvent] : [];
  });

  for (const holding of eligible) {
    const own = trades.filter((trade) => trade.investmentId === holding.id);
    const done = recorded.filter((event) => event.investmentId === holding.id);
    const blocked = undone.filter((event) => event.investmentId === holding.id);

    for (const event of market.filter((row) => row.ticker === holding.marketTicker)) {
      const { comDate, factor, note } = event;
      if (done.some((row) => sameEvent(row, event))) continue;
      if (blocked.some((row) => sameEvent(row, event))) continue;
      if (money(entitledQuantity(own, comDate, done)).lte(0)) continue;

      const registeredBefore = own
        .filter((trade) => trade.occurredOn <= comDate)
        .every((trade) => marketDateOf(trade.createdAt) < comDate);
      if (!registeredBefore) {
        result.unapplied.set(holding.id, { comDate, note });
        continue;
      }

      const quantityBefore = positionOf(own, done).quantity;
      const [row] = await tx
        .insert(investmentStockEvents)
        .values({ householdId, investmentId: holding.id, comDate, factor, note })
        .onConflictDoNothing()
        .returning();
      if (!row) continue;
      done.push(row);
      const quantityAfter = positionOf(own, done).quantity;
      const stockEvent: StockEventChange = {
        investmentId: holding.id,
        comDate,
        factor,
        note,
        quantityBefore,
        quantityAfter,
      };
      await recordApplied(tx, householdId, INVESTIMENTOS_AGENT, {
        kind: "investimento",
        ...quantidadeAjustadaText({
          ticker: holding.marketTicker,
          note,
          comDate,
          before: quantityBefore,
          after: quantityAfter,
        }),
        payload: { href: "/app/investimentos", stockEvent },
        dedupeKey: DEDUPE.investimentoAcoes(holding.id, comDate, note),
      });
      // Aviso que estava na fila perdeu o sentido: o ajuste já foi feito.
      await tx
        .delete(householdSuggestions)
        .where(
          and(
            eq(householdSuggestions.status, "pendente"),
            eq(householdSuggestions.dedupeKey, DEDUPE.investimentoEvento(holding.id, comDate)),
          ),
        );
      result.applied += 1;
    }
  }
  return result;
}

const emptyChanges = (): MarketChanges => ({ prices: [], created: [], adjusted: [], removed: [] });

interface Blocks {
  /** `investimento:cotação` já desfeita. */
  prices: Set<string>;
  /** Proventos de mercado desfeitos ou excluídos, por investimento. */
  proventos: Map<string, Set<string>>;
}

const priceKey = (investmentId: string, quoteDate: string) => `${investmentId}:${quoteDate}`;

/** O que a família desfez ou excluiu. Fica nas linhas `desfeita`, para sempre. */
export async function loadBlocks(tx: TenantTx): Promise<Blocks> {
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
  text: AgentText,
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
      ...messageColumns(text.message),
      payload: { href: "/app/investimentos", market },
    })
    .where(eq(householdSuggestions.id, existing.id));
}

export const noMarketData = (): MarketSyncResult => ({
  changes: emptyChanges(),
  applied: 0,
  created: 0,
  upcoming: 0,
  upcomingNet: "0.00",
  skippedFamily: 0,
  skippedTax: [],
});

export async function syncMarketData(
  tx: TenantTx,
  input: { today: string; householdId: string },
): Promise<MarketSyncResult> {
  const { today, householdId } = input;
  const result = noMarketData();
  const eligible = withMarketTicker(await tx.select().from(investments));
  if (eligible.length === 0) return result;

  const tickers = [...new Set(eligible.map((holding) => holding.marketTicker))];
  const stockEvents = await loadStockEvents(tx);
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
      stockEvents: stockEvents.filter((event) => event.investmentId === holding.id),
      events: events.filter((event) => event.ticker === holding.marketTicker),
      existing,
      blocked: blocks.proventos.get(holding.id) ?? new Set(),
      today,
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

  await saveDailyChange(
    tx,
    householdId,
    today,
    changes,
    mercadoDiaText({
      prices: changes.prices.length,
      labels,
      created: changes.created.length,
      upcoming: result.upcoming,
      upcomingNet: toDbAmount(upcomingNet),
      adjusted: changes.adjusted.length,
      removed: changes.removed.length,
      currency: await householdCurrency(tx),
    }),
  );
  return result;
}
