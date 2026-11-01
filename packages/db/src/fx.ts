// Câmbio de contas em dólar e euro (ADR-0020). As contas ficam em @organizeup/domain; aqui só saem os
// dados. `market_fx` é global e entra em qualquer transação, sem RLS de tenant.
import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import {
  entryFromReais,
  FX_CURRENCIES,
  isForeign,
  type Currency,
  type EntryMoney,
  type FxCurrency,
  type FxQuote,
  type FxRates,
} from "@organizeup/domain";
import { accounts, marketFx } from "./schema";
import type { TenantTx } from "./tenant";

const quoteFields = { rate: marketFx.rate, date: marketFx.date };
/** Depois de qualquer data: a última cotação que existe. */
const FAR_AHEAD = "9999-12-31";

/**
 * Cotação do dia ou a última anterior: não há PTAX em fim de semana e feriado, e data futura usa a
 * última. Null quando não existe cotação até a data.
 */
export async function fxRateOn(
  tx: TenantTx,
  currency: FxCurrency,
  date: string,
): Promise<FxQuote | null> {
  const [row] = await tx
    .select(quoteFields)
    .from(marketFx)
    .where(and(eq(marketFx.currency, currency), lte(marketFx.date, date)))
    .orderBy(desc(marketFx.date))
    .limit(1);
  return row ?? null;
}

/** Cotações que cobrem o intervalo, para `quoteOn`: evita uma consulta por linha na importação. */
export async function fxSeries(
  tx: TenantTx,
  currency: FxCurrency,
  from: string,
  to: string,
): Promise<FxQuote[]> {
  const before = await fxRateOn(tx, currency, from);
  const rows = await tx
    .select(quoteFields)
    .from(marketFx)
    .where(and(eq(marketFx.currency, currency), gt(marketFx.date, from), lte(marketFx.date, to)));
  return before ? [before, ...rows] : rows;
}

/** A última cotação de cada moeda: é a "de hoje" dos saldos. */
export async function latestFxRates(tx: TenantTx): Promise<FxRates> {
  const rates: FxRates = {};
  for (const currency of FX_CURRENCIES) {
    const quote = await fxRateOn(tx, currency, FAR_AHEAD);
    if (quote) rates[currency] = quote;
  }
  return rates;
}

export async function accountCurrency(tx: TenantTx, accountId: string): Promise<Currency | null> {
  const [row] = await tx
    .select({ currency: accounts.currency })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  return row?.currency ?? null;
}

/**
 * Colunas de um compromisso em reais (fatura, parcela, meta, aporte, renda) lançado na conta. Em conta
 * em real é só o valor. Null em conta estrangeira sem cotação, ou conta que não existe.
 */
export async function reaisEntry(
  tx: TenantTx,
  accountId: string,
  reais: string,
  date: string,
): Promise<EntryMoney | null> {
  const currency = await accountCurrency(tx, accountId);
  if (!currency) return null;
  const quote = isForeign(currency) ? await fxRateOn(tx, currency, date) : null;
  return entryFromReais(reais, currency, quote);
}

/** Contas com lançamento, previsão ou transferência: não podem mais mudar de moeda. */
export async function accountsWithMovement(tx: TenantTx): Promise<Set<string>> {
  const rows = await tx.execute<{ id: string }>(sql`
    select account_id as id from transactions
    union select account_id from cashflow_plans
    union select from_account_id from account_transfers
    union select to_account_id from account_transfers`);
  return new Set(rows.map((row) => row.id));
}
