// Carteira agrupada por tipo de ativo, com a fatia de cada tipo e de cada ativo sobre o total.
import { money, type MoneyValue } from "@organizeup/domain";

interface Holding {
  assetClass: string;
  value: string;
  position?: { cost: string };
}

export interface GroupedHolding<T extends Holding> {
  row: T;
  /** Fatia do ativo sobre a carteira inteira, em %, com uma casa. */
  percent: number;
  /** Fatia do ativo dentro do próprio tipo, em %: é o tamanho da barra no cartão do tipo. */
  inClass: number;
}

export interface ClassGroup<T extends Holding> {
  assetClass: string;
  /** Quanto o tipo vale hoje. */
  value: string;
  /** Quanto ainda está aplicado no tipo (custo das posições). */
  cost: string;
  /** Fatia do tipo sobre a carteira, em %, com uma casa. */
  percent: number;
  rows: GroupedHolding<T>[];
}

const share = (part: MoneyValue, whole: MoneyValue) =>
  whole.isZero() ? 0 : part.dividedBy(whole).times(100).toDecimalPlaces(1).toNumber();

/** Tipos do maior para o menor valor; dentro de cada um, os ativos também. Total zero: tudo em 0 %. */
export function groupByClass<T extends Holding>(rows: T[]): ClassGroup<T>[] {
  const total = rows.reduce((acc, row) => acc.plus(row.value), money(0));
  const byClass = new Map<string, T[]>();
  for (const row of rows)
    byClass.set(row.assetClass, [...(byClass.get(row.assetClass) ?? []), row]);
  return [...byClass.entries()]
    .map(([assetClass, list]) => {
      const value = list.reduce((acc, row) => acc.plus(row.value), money(0));
      const cost = list.reduce((acc, row) => acc.plus(row.position?.cost ?? 0), money(0));
      const sorted = [...list].sort((a, b) => money(b.value).comparedTo(a.value));
      return {
        assetClass,
        value: value.toFixed(2),
        cost: cost.toFixed(2),
        percent: share(value, total),
        rows: sorted.map((row) => ({
          row,
          percent: share(money(row.value), total),
          inClass: share(money(row.value), value),
        })),
      };
    })
    .sort((a, b) => money(b.value).comparedTo(a.value));
}
