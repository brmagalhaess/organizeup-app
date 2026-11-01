import Decimal from "decimal.js";

/**
 * Regras de dinheiro do OrganizeUp (ver docs/adr/0004-dinheiro-e-arredondamento.md).
 *
 * - Toda conta monetária usa decimal.js, nunca `number`.
 * - Valores são guardados no banco como `numeric(14,2)` e trafegam como string.
 * - Arredondamento: ROUND_HALF_EVEN ("bancário") apenas na borda (ao gravar ou exibir),
 *   nunca em passos intermediários. Parcelas: o resíduo de centavos vai para a última parcela.
 */
export const Money = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN });
export type MoneyValue = InstanceType<typeof Money>;
export type MoneyInput = string | number | MoneyValue;

export function money(value: MoneyInput): MoneyValue {
  const d = new Money(value);
  if (!d.isFinite()) {
    throw new RangeError(`Valor monetário inválido: ${String(value)}`);
  }
  return d;
}

/** Arredonda para centavos (2 casas) com a regra oficial. */
export function toCents(value: MoneyInput): MoneyValue {
  return money(value).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
}

/** Representação canônica para gravar em `numeric(14,2)`. */
export function toDbAmount(value: MoneyInput): string {
  return toCents(value).toFixed(2);
}

export const CURRENCIES = ["BRL", "USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** `compact`: eixos de gráfico ("R$ 8 mil"). `short`: inteiro até mil, compacto depois. */
export type MoneyStyle = "full" | "compact" | "short";

const formatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: Currency, locale: string, shape: "full" | "compact" | "whole") {
  const key = `${locale}|${currency}|${shape}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      // Em espanhol o símbolo normal do real é "BRL"; o estreito é "R$" em todo idioma. No dólar não
      // serve: o estreito tira o "US" e deixa "$" ambíguo em pt-BR.
      currencyDisplay: currency === "BRL" ? "narrowSymbol" : "symbol",
      ...(shape === "compact" ? { notation: "compact", maximumFractionDigits: 1 } : {}),
      ...(shape === "whole" ? { maximumFractionDigits: 0 } : {}),
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** Formata um valor na moeda e no idioma pedidos. Use sempre este helper na UI. */
export function formatMoney(
  value: MoneyInput,
  currency: Currency = "BRL",
  locale = "pt-BR",
  style: MoneyStyle = "full",
): string {
  const cents = toCents(value);
  const shape = style === "short" ? (cents.abs().lt(1000) ? "whole" : "compact") : style;
  // Intl recebe number apenas na borda, já arredondado para centavos.
  return moneyFormatter(currency, locale, shape).format(cents.toNumber());
}

/** Formata em reais (pt-BR). */
export function formatBRL(value: MoneyInput): string {
  return formatMoney(value);
}

/**
 * Converte texto digitado pelo usuário ("1.234,56", "R$ 10", "-3,5") em valor.
 * Lança erro se o texto não for um número válido.
 */
export function parseBRL(input: string): MoneyValue {
  const cleaned = input
    .replace(/\s|R\$/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new RangeError(`Não foi possível interpretar "${input}" como valor em reais.`);
  }
  return money(cleaned);
}

const decimalSeparators = new Map<string, string>();

function decimalSeparator(locale: string): string {
  let separator = decimalSeparators.get(locale);
  if (!separator) {
    separator =
      new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
        ?.value ?? ".";
    decimalSeparators.set(locale, separator);
  }
  return separator;
}

const occurrences = (text: string, char: string) => text.split(char).length - 1;

/** Milhar bem escrito: 1 a 3 dígitos, sem zero à esquerda, e depois sempre grupos de 3. */
const isGrouped = (digits: string, separator: string) =>
  digits
    .split(separator)
    .every((group, index) => (index === 0 ? /^[1-9]\d{0,2}$/ : /^\d{3}$/).test(group));

/**
 * Parte inteira e decimal do número. Com os dois separadores não há dúvida: o último é o decimal. Com
 * um só, a dúvida existe apenas em "1.234" e "1,234", e aí vale o idioma; nos outros casos só uma
 * leitura é possível. O que não fecha em nenhuma leitura devolve null.
 */
function splitNumber(text: string, locale: string): { whole: string; fraction: string } | null {
  const dots = occurrences(text, ".");
  const commas = occurrences(text, ",");
  if (dots === 0 && commas === 0) return { whole: text, fraction: "" };

  if (dots > 0 && commas > 0) {
    const decimal = text.lastIndexOf(".") > text.lastIndexOf(",") ? "." : ",";
    const group = decimal === "." ? "," : ".";
    if (occurrences(text, decimal) !== 1) return null;
    const [grouped = "", fraction = ""] = text.split(decimal);
    return isGrouped(grouped, group) ? { whole: grouped.replaceAll(group, ""), fraction } : null;
  }

  const separator = dots > 0 ? "." : ",";
  const thousands = isGrouped(text, separator);
  if (occurrences(text, separator) > 1) {
    return thousands ? { whole: text.replaceAll(separator, ""), fraction: "" } : null;
  }
  const [head = "", tail = ""] = text.split(separator);
  return thousands && separator !== decimalSeparator(locale)
    ? { whole: head + tail, fraction: "" }
    : { whole: head, fraction: tail };
}

/**
 * Converte texto digitado em valor, seguindo o idioma: "1.234" é mil duzentos e trinta e quatro em
 * `pt-BR` e um vírgula dois em `en`. "1.234,56" e "1,234.56" valem em qualquer idioma, com o símbolo da
 * moeda antes ou depois. Lança erro se o texto não for um número válido: valor não se adivinha.
 */
export function parseMoney(input: string, locale = "pt-BR"): MoneyValue {
  const cleaned = input
    .replace(/\s/g, "")
    .replace(/R\$|US\$|\$|€|BRL|USD|EUR/g, "")
    .replace("−", "-");
  const match = /^(-?)(\d[\d.,]*\d|\d)$/.exec(cleaned);
  const parts = match ? splitNumber(match[2]!, locale) : null;
  if (!match || !parts) throw new RangeError("Valor monetário inválido.");
  return money(`${match[1]}${parts.whole}${parts.fraction ? `.${parts.fraction}` : ""}`);
}

/**
 * Divide um total em N parcelas iguais em centavos; o resíduo vai para a última parcela,
 * garantindo que a soma das parcelas seja exatamente o total.
 */
export function splitInstallments(total: MoneyInput, count: number): MoneyValue[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError("Número de parcelas deve ser um inteiro positivo.");
  }
  const totalCents = toCents(total);
  const base = totalCents.dividedBy(count).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const parts = Array.from({ length: count }, () => base);
  const remainder = totalCents.minus(base.times(count));
  parts[count - 1] = base.plus(remainder);
  return parts;
}

/** Formato curto para eixos de gráfico ("R$ 8 mil"). */
export function formatBRLCompact(value: MoneyInput): string {
  return formatMoney(value, "BRL", "pt-BR", "compact");
}

/** Formato curto para espaços pequenos: reais inteiros até mil ("R$ 390"), depois "R$ 2,4 mil". */
export function formatBRLShort(value: MoneyInput): string {
  return formatMoney(value, "BRL", "pt-BR", "short");
}
