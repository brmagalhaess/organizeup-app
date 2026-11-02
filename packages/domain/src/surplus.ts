// Excedente mensal da família (ADR-0015). Puro e estimativa: o que sobra de receitas menos despesas
// nos meses fechados vira a base do que o assistente sugere guardar. Guardar não é gastar: os pontos de
// `monthlySeries` já vêm sem aporte e resgate, pela regra de `savings.ts`, e o que a família já guarda
// por mês é medido à parte em `savingHabit`, para a divisão não repartir de novo o mesmo dinheiro.
import {
  splitMonthEntries,
  type CardSavings,
  type MonthPoint,
  type TransactionInput,
} from "./cashflow";
import { money, toCents, toDbAmount, type MoneyValue } from "./money";
import { savingsDestination, type SavingsRule } from "./savings";

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

export interface SavedMonth {
  month: string;
  /** Aportes em investimento menos resgates, no líquido: aplicação e resgate automáticos se anulam. */
  invested: string;
  /** Parcelas de meta pagas. A entrada na conta de destino não abate: o dinheiro foi guardado. */
  goals: string;
}

/**
 * O que foi guardado em cada mês, das mesmas entradas de `monthlySeries`: o aporte feito no cartão
 * entra aqui do mesmo jeito que sai da despesa, e excedente e hábito fecham.
 */
export function savedByMonth(
  months: string[],
  transactions: TransactionInput[],
  rule: SavingsRule,
  cards?: CardSavings,
): SavedMonth[] {
  return months.map((month) => {
    const done = splitMonthEntries(month, [], transactions, rule, cards).filter(
      (entry) => entry.status === "realizado",
    );
    const invested = done
      .filter((entry) => savingsDestination(entry, rule) === "investimento")
      .reduce(
        (acc, row) => (row.kind === "despesa" ? acc.plus(row.amount) : acc.minus(row.amount)),
        money(0),
      );
    const goals = done
      .filter((entry) => entry.kind === "despesa" && savingsDestination(entry, rule) === "meta")
      .reduce((acc, row) => acc.plus(row.amount), money(0));
    return { month, invested: toDbAmount(invested), goals: toDbAmount(goals) };
  });
}

/**
 * Quanto sai todo mês para investimento ou meta, como hábito: `min(média, mediana)` dos meses com
 * movimento, igual ao excedente, e nunca negativo. O pico de um mês não vira compromisso. Os casos estão
 * no ADR-0027: quem começou há pouco ou aporta por trimestre fica com hábito zero.
 */
export function savingHabit(values: string[], points: MonthPoint[]): string {
  const active = values
    .filter((_, index) => {
      const point = points[index];
      if (!point) return false;
      return [point.received, point.spent, point.contributed, point.redeemed].some(
        (value) => !money(value).isZero(),
      );
    })
    .map((value) => money(value));
  if (active.length < SURPLUS_RULES.minMonths) return "0.00";
  const average = active.reduce((acc, value) => acc.plus(value), money(0)).dividedBy(active.length);
  const median = medianOf(active);
  const usable = active.length < SURPLUS_RULES.fullMonths || median.lt(average) ? median : average;
  return toDbAmount(usable.gt(0) ? usable : 0);
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
