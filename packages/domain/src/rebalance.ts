// Divide um aporte entre as classes abaixo da meta da família. Fala de classes, nunca de ativo. Puro.
import { money, toDbAmount } from "./money";

export interface ClassPosition {
  assetClass: string;
  value: string;
  /** Meta em %. Null: a classe não entra na divisão. */
  target: number | null;
}

export interface ContributionPlan {
  rows: Array<{ assetClass: string; amount: string }>;
  /** O que não coube: as classes com meta já ficam no alvo. */
  leftover: string;
}

/** Se faltar mais do que o aporte, cada classe recebe em proporção ao que falta para ela. */
export function distributeContribution(classes: ClassPosition[], amount: string): ContributionPlan {
  const total = classes.reduce((acc, row) => acc.plus(row.value), money(amount));
  const gaps = classes.flatMap((row) => {
    if (row.target === null) return [];
    const gap = total.times(row.target).dividedBy(100).minus(row.value);
    return gap.gt(0) ? [{ assetClass: row.assetClass, gap }] : [];
  });
  const missing = gaps.reduce((acc, row) => acc.plus(row.gap), money(0));
  const share = missing.gt(amount) ? money(amount).dividedBy(missing) : money(1);
  const rows = gaps
    .map((row) => ({ assetClass: row.assetClass, amount: toDbAmount(row.gap.times(share)) }))
    .filter((row) => money(row.amount).gt(0));
  const used = rows.reduce((acc, row) => acc.plus(row.amount), money(0));
  const leftover = money(amount).minus(used);
  return { rows, leftover: toDbAmount(leftover.gt(0) ? leftover : 0) };
}
