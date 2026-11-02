// Câmbio entre real, dólar e euro (ADR-0020). Puras: a cotação vem de quem chama. Toda conversão passa
// por aqui, com decimal.js, e arredonda em centavos pela regra do ADR-0004. Nunca `number`. O real é o
// pivô: `market_fx` guarda reais por unidade, e dólar para euro passa por ele. "Estrangeira" é a moeda
// diferente da principal da família: em família em dólar, a conta em real é a estrangeira.
import { money, toDbAmount, type Currency, type MoneyValue } from "./money";

export const FX_CURRENCIES = ["USD", "EUR"] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];

/** Valor ou cotação: texto do banco ou decimal. `number` não entra, nem na execução. */
export type FxValue = string | MoneyValue;

/** Cotação por unidade da moeda, e o dia dela. Em `FxRates`, sempre em reais. */
export interface FxQuote {
  rate: string;
  date: string;
}

export type FxRates = Partial<Record<FxCurrency, FxQuote>>;

export const isForeign = (currency: Currency, main: Currency = "BRL") => currency !== main;

const SYMBOLS: Record<Currency, string> = { BRL: "R$", USD: "US$", EUR: "€" };
const NAMES: Record<Currency, string> = { BRL: "real", USD: "dólar", EUR: "euro" };

/** Para rótulos de campo: "Valor (US$)". */
export const currencySymbol = (currency: Currency) => SYMBOLS[currency];
export const currencyName = (currency: Currency) => NAMES[currency];

function decimal(value: FxValue): MoneyValue {
  if (typeof value === "number") throw new TypeError("Câmbio não aceita number.");
  return money(value);
}

/** Valor na moeda estrangeira, na moeda principal. Arredonda em centavos. */
export const toMain = (value: FxValue, rate: FxValue): string =>
  toDbAmount(decimal(value).times(decimal(rate)));

/** Valor na moeda principal, na moeda estrangeira. Arredonda em centavos. */
export const fromMain = (value: FxValue, rate: FxValue): string =>
  toDbAmount(decimal(value).dividedBy(decimal(rate)));

/** Reais por unidade da moeda. Null sem cotação. */
const reaisPerUnit = (currency: Currency, rates: FxRates): string | null =>
  currency === "BRL" ? "1" : (rates[currency]?.rate ?? null);

/** Casas de `numeric(20,8)`, a coluna que congela a cotação. */
const RATE_PLACES = 8;

/**
 * Cotação de `from` em `to`, sempre com o real como pivô: `from` em reais, dividido por `to` em reais.
 * O dia é o da cotação mais antiga usada. Null sem cotação de alguma das duas, ou com moedas iguais, em
 * que não há o que converter.
 */
export function crossQuote(from: Currency, to: Currency, rates: FxRates): FxQuote | null {
  if (from === to) return null;
  const fromRate = reaisPerUnit(from, rates);
  const toRate = reaisPerUnit(to, rates);
  if (!fromRate || !toRate) return null;
  const dates = [from, to].flatMap((currency) =>
    currency === "BRL" ? [] : [rates[currency]!.date],
  );
  return {
    rate: decimal(fromRate).dividedBy(decimal(toRate)).toFixed(RATE_PLACES),
    date: dates.sort()[0]!,
  };
}

/**
 * Função única de conversão entre as três moedas: `from` em `to`, com o real como pivô e sem arredondar
 * no meio do caminho. Com moedas iguais, é o próprio valor. Null sem cotação.
 */
export function convertMoney(
  value: FxValue,
  from: Currency,
  to: Currency,
  rates: FxRates,
): string | null {
  if (from === to) return toDbAmount(decimal(value));
  const fromRate = reaisPerUnit(from, rates);
  const toRate = reaisPerUnit(to, rates);
  if (!fromRate || !toRate) return null;
  return toDbAmount(decimal(value).times(decimal(fromRate)).dividedBy(decimal(toRate)));
}

/**
 * Cotação do dia ou a última anterior: não há PTAX em fim de semana e feriado, e data futura usa a
 * última. Null quando a série não tem nada até a data.
 */
export function quoteOn(series: readonly FxQuote[], date: string): FxQuote | null {
  let found: FxQuote | null = null;
  for (const quote of series) {
    if (quote.date <= date && (!found || quote.date > found.date)) found = quote;
  }
  return found;
}

/**
 * O mesmo de `crossQuote`, com as séries de cada moeda: sem PTAX no dia, vale a última anterior.
 */
export function crossQuoteOn(
  series: Partial<Record<FxCurrency, readonly FxQuote[]>>,
  from: Currency,
  to: Currency,
  date: string,
): FxQuote | null {
  const rates: FxRates = {};
  for (const currency of FX_CURRENCIES) {
    const quote = quoteOn(series[currency] ?? [], date);
    if (quote) rates[currency] = quote;
  }
  return crossQuote(from, to, rates);
}

/**
 * O que um lançamento grava: `amount` sempre na moeda principal da família e, em conta estrangeira, o
 * valor de origem. `original_currency` só aceita dólar e euro (migração 0030): a conta em real de família
 * em dólar ou euro guarda a origem em `brl_amount` e `brl_rate`. Quem lê usa `entryOrigin`.
 */
export interface EntryMoney {
  amount: string;
  originalAmount: string | null;
  originalCurrency: FxCurrency | null;
  fxRate: string | null;
  brlAmount: string | null;
  brlRate: string | null;
}

const inMain = (amount: string): EntryMoney => ({
  amount,
  originalAmount: null,
  originalCurrency: null,
  fxRate: null,
  brlAmount: null,
  brlRate: null,
});

const withOrigin = (
  amount: string,
  original: string,
  currency: Currency,
  rate: string,
): EntryMoney =>
  currency === "BRL"
    ? { ...inMain(amount), brlAmount: original, brlRate: rate }
    : { ...inMain(amount), originalAmount: original, originalCurrency: currency, fxRate: rate };

/** Ao menos um centavo: a coluna recusa zero, e R$ 0,01 em dólar arredonda para nada. */
const atLeastOneCent = (value: string) => (money(value).gt(0) ? value : "0.01");

/**
 * Valor digitado na moeda da conta. `amount` é o valor vezes a cotação, arredondado. `quote` é a
 * cotação da moeda da conta na moeda principal (`crossQuote`). Null em conta estrangeira sem cotação.
 */
export function entryFromTyped(
  value: FxValue,
  currency: Currency,
  quote: FxQuote | null,
  main: Currency = "BRL",
): EntryMoney | null {
  if (!isForeign(currency, main)) return inMain(toDbAmount(decimal(value)));
  if (!quote) return null;
  const amount = atLeastOneCent(toMain(value, quote.rate));
  return withOrigin(amount, toDbAmount(decimal(value)), currency, quote.rate);
}

/**
 * Compromisso na moeda principal (fatura, parcela, meta, aporte, renda) em conta estrangeira. Quem manda
 * é o valor na moeda principal, que fica exato: o que sai da conta é ele dividido pela cotação, ao menos
 * um centavo. Por isso `amount` pode diferir por centavos de `original × cotação`. Null sem cotação.
 */
export function entryFromMain(
  value: FxValue,
  currency: Currency,
  quote: FxQuote | null,
  main: Currency = "BRL",
): EntryMoney | null {
  const amount = toDbAmount(decimal(value));
  if (!isForeign(currency, main)) return inMain(amount);
  if (!quote) return null;
  return withOrigin(amount, atLeastOneCent(fromMain(amount, quote.rate)), currency, quote.rate);
}

/** Valor na moeda da conta e cotação congelada de um lançamento em conta estrangeira. */
export interface EntryOrigin {
  amount: string;
  currency: Currency;
  rate: string;
}

/** Lê a origem gravada pelas colunas de `EntryMoney`. Null: a conta está na moeda principal. */
export function entryOrigin(row: {
  originalAmount?: string | null;
  originalCurrency?: FxCurrency | null;
  fxRate?: string | null;
  brlAmount?: string | null;
  brlRate?: string | null;
}): EntryOrigin | null {
  if (row.originalAmount && row.originalCurrency && row.fxRate)
    return { amount: row.originalAmount, currency: row.originalCurrency, rate: row.fxRate };
  if (row.brlAmount && row.brlRate)
    return { amount: row.brlAmount, currency: "BRL", rate: row.brlRate };
  return null;
}

/** Cabe em `numeric(14,2)`? Valor digitado em dólar pode passar do limite depois de convertido. */
export const fitsAmount = (value: FxValue) => decimal(value).abs().lt("1000000000000");

const fullDate = (date: string) => date.split("-").reverse().join("/");

/** Frase das telas em português com conversão. Null quando não há o que dizer. */
export function fxNoteText(fx: FxTotalNote | null): string | null {
  if (!fx) return null;
  const parts = fx.date ? [`Convertido pela cotação de ${fullDate(fx.date)}.`] : [];
  if (fx.missing.length > 0) {
    const names = fx.missing.map(currencyName).join(" e ");
    parts.push(`Ainda sem cotação de ${names}: essas contas ficam fora da soma.`);
  }
  return parts.join(" ");
}

/** Saldo na moeda principal pela cotação informada. Null quando falta cotação. */
export const balanceInMain = (
  balance: FxValue,
  currency: Currency,
  rates: FxRates,
  main: Currency = "BRL",
): string | null => convertMoney(balance, currency, main, rates);

export interface FxTotalNote {
  /** Dia da cotação mais antiga usada. Null sem conversão. */
  date: string | null;
  /** Moedas sem cotação: as contas delas ficam fora da soma. */
  missing: FxCurrency[];
}

/**
 * O que a tela precisa dizer sobre a conversão. Null quando só há a moeda principal, e aí a tela não
 * muda. Com moeda principal fora do real, a cotação dela também entra na conta, pelo pivô.
 */
export function fxNoteOf(
  rows: ReadonlyArray<{ currency: Currency; archived?: boolean }>,
  rates: FxRates,
  main: Currency = "BRL",
): FxTotalNote | null {
  const foreign = [
    ...new Set(rows.filter((row) => !row.archived).map((row) => row.currency)),
  ].filter((currency) => isForeign(currency, main));
  if (foreign.length === 0) return null;
  const used = FX_CURRENCIES.filter((currency) => foreign.includes(currency) || currency === main);
  const dates = used.flatMap((currency) => rates[currency]?.date ?? []).sort();
  return { date: dates[0] ?? null, missing: used.filter((currency) => !rates[currency]) };
}

/** Quanto entraria na conta de destino pela cotação informada. Null quando falta cotação. */
export const suggestTransfer = convertMoney;

/**
 * Taxa real de uma transferência entre moedas: reais por unidade da moeda estrangeira, ou unidades de
 * destino por unidade de origem entre duas estrangeiras. Null se não couber em `numeric(20,8)`.
 */
export function transferRate(amount: FxValue, from: Currency, toAmount: FxValue): string | null {
  const [units, reais] = from === "BRL" ? [toAmount, amount] : [amount, toAmount];
  if (decimal(units).isZero() || decimal(reais).isZero()) return null;
  const stored = decimal(reais).dividedBy(decimal(units)).toFixed(8);
  return money(stored).gt(0) && money(stored).lt("100000000000") ? stored : null;
}
