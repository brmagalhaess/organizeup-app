// Câmbio de contas em dólar e euro (ADR-0020). Puras: a cotação vem de quem chama. Toda conversão passa
// por aqui, com decimal.js, e arredonda em centavos pela regra do ADR-0004. Nunca `number`.
import { money, toDbAmount, type Currency, type MoneyValue } from "./money";

export const FX_CURRENCIES = ["USD", "EUR"] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];

/** Valor ou cotação: texto do banco ou decimal. `number` não entra, nem na execução. */
export type FxValue = string | MoneyValue;

/** Cotação em reais por unidade da moeda, e o dia dela. */
export interface FxQuote {
  rate: string;
  date: string;
}

export type FxRates = Partial<Record<FxCurrency, FxQuote>>;

export const isForeign = (currency: Currency): currency is FxCurrency => currency !== "BRL";

const SYMBOLS: Record<Currency, string> = { BRL: "R$", USD: "US$", EUR: "€" };
const NAMES: Record<Currency, string> = { BRL: "real", USD: "dólar", EUR: "euro" };

/** Para rótulos de campo: "Valor (US$)". */
export const currencySymbol = (currency: Currency) => SYMBOLS[currency];
export const currencyName = (currency: Currency) => NAMES[currency];

function decimal(value: FxValue): MoneyValue {
  if (typeof value === "number") throw new TypeError("Câmbio não aceita number.");
  return money(value);
}

/** Valor na moeda estrangeira, em reais. Arredonda em centavos. */
export const toReais = (value: FxValue, rate: FxValue): string =>
  toDbAmount(decimal(value).times(decimal(rate)));

/** Reais na moeda estrangeira. Arredonda em centavos. */
export const fromReais = (reais: FxValue, rate: FxValue): string =>
  toDbAmount(decimal(reais).dividedBy(decimal(rate)));

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

/** O que um lançamento grava: `amount` sempre em reais e, em conta estrangeira, o valor de origem. */
export interface EntryMoney {
  amount: string;
  originalAmount: string | null;
  originalCurrency: FxCurrency | null;
  fxRate: string | null;
}

const inReais = (amount: string): EntryMoney => ({
  amount,
  originalAmount: null,
  originalCurrency: null,
  fxRate: null,
});

/**
 * Valor digitado na moeda da conta. `amount` é o valor vezes a cotação, arredondado. Null em conta
 * estrangeira sem cotação.
 */
export function entryFromTyped(
  value: FxValue,
  currency: Currency,
  quote: FxQuote | null,
): EntryMoney | null {
  if (!isForeign(currency)) return inReais(toDbAmount(decimal(value)));
  if (!quote) return null;
  return {
    amount: toReais(value, quote.rate),
    originalAmount: toDbAmount(decimal(value)),
    originalCurrency: currency,
    fxRate: quote.rate,
  };
}

/**
 * Compromisso em reais (fatura, parcela, meta, aporte, renda) em conta estrangeira. Quem manda é o valor
 * em reais, que fica exato: o que sai da conta é ele dividido pela cotação, ao menos um centavo. Por
 * isso `amount` pode diferir por centavos de `original × cotação`. Null sem cotação.
 */
export function entryFromReais(
  reais: FxValue,
  currency: Currency,
  quote: FxQuote | null,
): EntryMoney | null {
  const amount = toDbAmount(decimal(reais));
  if (!isForeign(currency)) return inReais(amount);
  if (!quote) return null;
  const original = fromReais(amount, quote.rate);
  return {
    amount,
    originalAmount: money(original).gt(0) ? original : "0.01",
    originalCurrency: currency,
    fxRate: quote.rate,
  };
}

/** Cabe em `numeric(14,2)`? Valor digitado em dólar pode passar do limite depois de convertido. */
export const fitsAmount = (reais: FxValue) => decimal(reais).abs().lt("1000000000000");

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

/** Saldo em reais pela cotação informada. Null quando falta cotação. */
export function balanceInReais(
  balance: FxValue,
  currency: Currency,
  rates: FxRates,
): string | null {
  if (!isForeign(currency)) return toDbAmount(decimal(balance));
  const quote = rates[currency];
  return quote ? toReais(balance, quote.rate) : null;
}

export interface FxTotalNote {
  /** Dia da cotação mais antiga usada. Null sem conversão. */
  date: string | null;
  /** Moedas sem cotação: as contas delas ficam fora da soma. */
  missing: FxCurrency[];
}

/** O que a tela precisa dizer sobre a conversão. Null quando só há real, e aí a tela não muda. */
export function fxNoteOf(
  rows: ReadonlyArray<{ currency: Currency; archived?: boolean }>,
  rates: FxRates,
): FxTotalNote | null {
  const used = [...new Set(rows.filter((row) => !row.archived).map((row) => row.currency))].filter(
    isForeign,
  );
  if (used.length === 0) return null;
  const dates = used.flatMap((currency) => rates[currency]?.date ?? []).sort();
  return { date: dates[0] ?? null, missing: used.filter((currency) => !rates[currency]) };
}

/**
 * Quanto entraria na conta de destino pela cotação informada. Entre duas moedas estrangeiras, passa pelo
 * real. Null quando falta cotação.
 */
export function suggestTransfer(
  amount: FxValue,
  from: Currency,
  to: Currency,
  rates: FxRates,
): string | null {
  if (from === to) return toDbAmount(decimal(amount));
  const reais = balanceInReais(amount, from, rates);
  if (reais === null) return null;
  if (!isForeign(to)) return reais;
  const quote = rates[to];
  return quote ? fromReais(reais, quote.rate) : null;
}

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
