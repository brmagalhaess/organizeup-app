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

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Formata em reais (pt-BR). Use sempre este helper na UI. */
export function formatBRL(value: MoneyInput): string {
  // Intl recebe number apenas na borda, já arredondado para centavos.
  return brl.format(toCents(value).toNumber());
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

const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Formato curto para eixos de gráfico ("R$ 8 mil"). */
export function formatBRLCompact(value: MoneyInput): string {
  return brlCompact.format(toCents(value).toNumber());
}
