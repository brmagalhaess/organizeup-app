// Excedente mensal da família (ADR-0015). Puro e estimativa: o que sobra de receitas menos despesas
// nos meses fechados vira a base do que o assistente sugere guardar. O chamador monta os pontos
// com `monthlySeries` já sem o que a família guarda (categorias `GOAL_CATEGORY` e
// `CONTRIBUTION_CATEGORY` e os lançamentos ligados a `goal_contributions`), porque guardar não é
// gastar. `excludeSavings` faz esse filtro.
import type { MonthPoint, TransactionInput } from "./cashflow";
import { money, toCents, toDbAmount, type MoneyValue } from "./money";

export const SURPLUS_RULES = {
  /** Abaixo disso não há base: `sem_dados`. */
  minMonths: 3,
  /** A partir daqui a média entra junto com a mediana. */
  fullMonths: 6,
  /** Folga padrão antes de distribuir o excedente. */
  slackPercent: 10,
} as const;

export type SurplusBasis = "media_mediana" | "mediana" | "sem_dados";

export interface SurplusResult {
  average: string;
  median: string;
  /** O que dá para contar: `min(média, mediana)` com 6+ meses, mediana com 3 a 5, zero sem dados. */
  usable: string;
  /** Meses fechados com algum lançamento. */
  months: number;
  basis: SurplusBasis;
}

/** Tira do histórico o que a família guardou: categorias de metas/aportes e parcelas confirmadas. */
export function excludeSavings(
  transactions: TransactionInput[],
  exclude: { categoryIds: Iterable<string>; transactionIds: Iterable<string> },
): TransactionInput[] {
  const categories = new Set(exclude.categoryIds);
  const ids = new Set(exclude.transactionIds);
  return transactions.filter((row) => !categories.has(row.categoryId) && !ids.has(row.id));
}

const medianOf = (values: MoneyValue[]): MoneyValue => {
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return sorted[middle - 1]!.plus(sorted[middle]!).dividedBy(2);
};

/**
 * Excedente típico por mês. Só meses fechados com algum lançamento contam; o chamador passa só
 * meses fechados. Pode ser negativo: a família gasta mais do que recebe.
 */
export function monthlySurplus(
  points: MonthPoint[],
  options: { minMonths?: number } = {},
): SurplusResult {
  const minMonths = options.minMonths ?? SURPLUS_RULES.minMonths;
  const balances = points
    .filter((point) => money(point.received).gt(0) || money(point.spent).gt(0))
    .map((point) => money(point.received).minus(point.spent));
  const months = balances.length;
  if (months === 0 || months < minMonths) {
    return { average: "0.00", median: "0.00", usable: "0.00", months, basis: "sem_dados" };
  }
  const average = balances.reduce((acc, value) => acc.plus(value), money(0)).dividedBy(months);
  const median = medianOf(balances);
  const full = months >= Math.max(SURPLUS_RULES.fullMonths, minMonths);
  const usable = full ? (average.lt(median) ? average : median) : median;
  return {
    average: toDbAmount(average),
    median: toDbAmount(median),
    usable: toDbAmount(usable),
    months,
    basis: full ? "media_mediana" : "mediana",
  };
}

/**
 * Excedente previsto para quem ainda não tem histórico: renda líquida típica (sem férias e 13º)
 * menos as previsões recorrentes de despesa. O chamador marca `basis: "previsto"`.
 */
export function forecastSurplus(incomeMonthlyNet: string, plannedExpenses: string): string {
  return toDbAmount(money(incomeMonthlyNet).minus(plannedExpenses));
}

/** Quanto do excedente entra na divisão, depois da folga. Nunca negativo. */
export function availableToAllocate(
  surplus: string,
  slackPercent: number = SURPLUS_RULES.slackPercent,
): string {
  const available = toCents(money(surplus).times(money(100).minus(slackPercent).dividedBy(100)));
  return toDbAmount(available.gt(0) ? available : 0);
}
