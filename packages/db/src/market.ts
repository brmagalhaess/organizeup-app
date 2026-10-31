// Helpers das tabelas globais de mercado (ADR-0017). Sem dado de família e sem RLS de tenant: rodam
// fora de withHousehold, como os do schema `ops`. Gravar exige a conexão ou_worker.
import { asc, sql } from "drizzle-orm";
import { appPool } from "./client";
import {
  marketDividends,
  marketIndices,
  marketQuotes,
  marketTickers,
  marketUsage,
  type MarketIndexCode,
  type MarketTickerStatus,
} from "./schema";

export interface MarketQuoteRow {
  ticker: string;
  price: string;
  changePercent: string | null;
  quotedAt: Date;
  source: string;
  lastStockEventOn: string | null;
  lastStockEventNote: string | null;
}

export async function saveMarketQuote(quote: MarketQuoteRow): Promise<void> {
  await appPool()
    .db.insert(marketQuotes)
    .values(quote)
    .onConflictDoUpdate({
      target: marketQuotes.ticker,
      set: { ...quote, updatedAt: sql`now()` },
    });
}

export interface MarketDividendRow {
  ticker: string;
  kind: "dividendo" | "jcp" | "rendimento";
  comDate: string;
  exDate: string | null;
  payDate: string;
  ratePerShare: string;
  seq: number;
  source: string;
}

/** Grava os proventos de um ticker. Valor corrigido na fonte atualiza a linha. */
export async function saveMarketDividends(rows: MarketDividendRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const t = marketDividends;
  await appPool()
    .db.insert(t)
    .values(rows)
    .onConflictDoUpdate({
      target: [t.ticker, t.kind, t.comDate, t.payDate, t.seq],
      set: {
        ratePerShare: sql`excluded.rate_per_share`,
        exDate: sql`excluded.ex_date`,
        source: sql`excluded.source`,
        updatedAt: sql`now()`,
      },
    });
  return rows.length;
}

export async function saveMarketIndices(
  rows: Array<{ code: MarketIndexCode; date: string; value: string }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const t = marketIndices;
  await appPool()
    .db.insert(t)
    .values(rows)
    .onConflictDoUpdate({
      target: [t.code, t.date],
      set: { value: sql`excluded.value` },
    });
  return rows.length;
}

export async function listMarketTickers() {
  return appPool().db.select().from(marketTickers).orderBy(asc(marketTickers.checkedAt));
}

/** Registra o resultado da consulta de um ticker. `null` em `dividendsRetryOn` mantém o valor. */
export async function saveMarketTicker(input: {
  ticker: string;
  status: MarketTickerStatus;
  retryOn: string | null;
  errorCode: string | null;
  dividendsRetryOn?: string | null;
}): Promise<void> {
  const { ticker, status, retryOn, errorCode, dividendsRetryOn = null } = input;
  const t = marketTickers;
  await appPool()
    .db.insert(t)
    .values({ ticker, status, retryOn, errorCode, dividendsRetryOn })
    .onConflictDoUpdate({
      target: t.ticker,
      set: {
        status,
        retryOn,
        errorCode,
        checkedAt: sql`now()`,
        dividendsRetryOn: sql`coalesce(${dividendsRetryOn}::date, ${t.dividendsRetryOn})`,
      },
    });
}

/** Soma chamadas ao dia. Rode logo depois de cada chamada, para um erro não apagar a conta. */
export async function addMarketCalls(day: string, calls: number): Promise<void> {
  const t = marketUsage;
  await appPool()
    .db.insert(t)
    .values({ day, calls })
    .onConflictDoUpdate({ target: t.day, set: { calls: sql`${t.calls} + ${calls}` } });
}

export async function marketCallsOn(day: string): Promise<number> {
  const rows = await appPool().sql<
    { calls: number }[]
  >`select calls from public.market_usage where day = ${day}`;
  return rows[0]?.calls ?? 0;
}
