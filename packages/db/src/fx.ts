// Câmbio entre as moedas da família (ADR-0020). As contas ficam em @organizeup/domain; aqui só saem os
// dados. `market_fx` é global e entra em qualquer transação, sem RLS de tenant.
import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import {
  crossQuote,
  entryFromMain,
  FX_CURRENCIES,
  isForeign,
  type Currency,
  type EntryMoney,
  type FxCurrency,
  type FxQuote,
  type FxRates,
} from "@organizeup/domain";
import { accounts, householdSettings, marketFx } from "./schema";
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

/** Moeda principal da família. Sem linha de configurações, real. */
export async function householdCurrency(tx: TenantTx): Promise<Currency> {
  const [row] = await tx
    .select({ currency: householdSettings.mainCurrency })
    .from(householdSettings);
  return row?.currency ?? "BRL";
}

/**
 * Cotação de `from` na moeda principal `main`, do dia ou a última anterior, com o real como pivô. Null
 * com moedas iguais ou sem cotação.
 */
export async function fxQuoteIn(
  tx: TenantTx,
  from: Currency,
  main: Currency,
  date: string,
): Promise<FxQuote | null> {
  if (from === main) return null;
  const rates: FxRates = {};
  for (const currency of FX_CURRENCIES) {
    if (currency !== from && currency !== main) continue;
    const quote = await fxRateOn(tx, currency, date);
    if (quote) rates[currency] = quote;
  }
  return crossQuote(from, main, rates);
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
 * Colunas de um compromisso na moeda principal (fatura, parcela, meta, aporte, renda) lançado na conta.
 * Em conta na moeda principal é só o valor. Null em conta estrangeira sem cotação, ou conta que não
 * existe.
 */
export async function mainEntry(
  tx: TenantTx,
  accountId: string,
  value: string,
  date: string,
): Promise<EntryMoney | null> {
  const currency = await accountCurrency(tx, accountId);
  if (!currency) return null;
  const main = await householdCurrency(tx);
  const quote = isForeign(currency, main) ? await fxQuoteIn(tx, currency, main, date) : null;
  return entryFromMain(value, currency, quote, main);
}

/**
 * A moeda principal só muda enquanto a família não tiver lançamento, compra de cartão, dívida,
 * investimento, meta nem transferência. Não existe conversão de histórico.
 */
export async function householdHasMovement(tx: TenantTx): Promise<boolean> {
  const rows = await tx.execute<{ found: boolean }>(sql`
    select exists (select 1 from transactions)
      or exists (select 1 from card_purchases)
      or exists (select 1 from debts)
      or exists (select 1 from investments)
      or exists (select 1 from goals)
      or exists (select 1 from account_transfers) as found`);
  return Boolean(rows[0]?.found);
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
