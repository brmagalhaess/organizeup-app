// Divisão do excedente (ADR-0015). Puro e estimativa: dado o que sobra por mês, sugere quanto vai
// para reserva, dívidas caras, aposentadoria, metas e viagens, nesta ordem. A família decide; o
// agente só grava sugestões e dados derivados. Percentuais fixos documentados no ADR.
import { formatMoney, money, toCents, toDbAmount, type Currency, type MoneyValue } from "./money";
import { monthlyRate } from "./retirement";

export const ALLOCATION_RULES = {
  /** Folga sobre o excedente antes de dividir (ver `availableToAllocate`). */
  slackPercent: 10,
  /** Até metade do disponível vai para a reserva enquanto faltar. */
  reserveShare: 0.5,
  /** Até 70% do que resta quita dívidas caras. */
  debtShare: 0.7,
  /** Até 70% do que resta vai para a aposentadoria. */
  retirementShare: 0.7,
  /** O que sobra divide meio a meio entre metas e viagens. */
  goalsShare: 0.5,
  /** Dívida cara: taxa mensal acima disto (% a.m.) ou acima do rendimento mensal da carteira. */
  expensiveDebtMonthlyRate: "1.00",
} as const;

export interface AllocationInput {
  /** Saída de `availableToAllocate`. */
  available: string;
  /** Quanto falta para a reserva de emergência. */
  reserveMissing: string;
  /** Saldo das dívidas ativas caras (ver `isExpensiveDebt`). */
  expensiveDebtBalance: string;
  /** Aporte mensal que fecha a aposentadoria. Null quando o plano está incompleto. */
  retirementRequired: string | null;
  /** Quanto as viagens já confirmadas pedem por mês; é descontado uma vez, aqui. */
  confirmedTripsMonthly: string;
  /** Meses de histórico, só para o texto da nota. */
  surplusMonths?: number;
  /** Moeda principal da família, para as notas. Sem ela, real. */
  currency?: Currency;
}

export interface Allocation {
  reserve: string;
  debt: string;
  retirement: string;
  goalsBudget: string;
  /** O que sobra para viagens novas depois das confirmadas. */
  tripsBudget: string;
  /** Parte do orçamento de viagens já tomada pelas confirmadas. */
  tripsCommitted: string;
  /** O que as viagens confirmadas pedem além do que sobra para viagens. */
  shortfall: string;
  notes: string[];
}

/** Dívida que vale mais quitar do que investir. `yieldAnnualPercent` é o rendimento usado no plano. */
export function isExpensiveDebt(
  monthlyRatePercent: string,
  yieldAnnualPercent: string | null,
): boolean {
  const rate = money(monthlyRatePercent);
  if (rate.gt(ALLOCATION_RULES.expensiveDebtMonthlyRate)) return true;
  if (yieldAnnualPercent === null) return false;
  return rate.gt(monthlyRate(yieldAnnualPercent).times(100));
}

const min = (a: MoneyValue, b: MoneyValue) => (a.lt(b) ? a : b);
const positive = (value: MoneyValue) => (value.gt(0) ? value : money(0));

/**
 * Reserva primeiro, depois dívidas caras, depois aposentadoria, e o resto meio a meio entre metas e
 * viagens. Cada passo arredonda em centavos, para a soma das partes fechar exatamente no disponível.
 */
export function suggestAllocation(input: AllocationInput): Allocation {
  const { currency } = input;
  const notes: string[] = [];
  const available = positive(toCents(input.available));
  const zero = "0.00";
  if (available.isZero()) {
    const period = input.surplusMonths
      ? `nos últimos ${input.surplusMonths} meses`
      : "nos últimos meses";
    return {
      reserve: zero,
      debt: zero,
      retirement: zero,
      goalsBudget: zero,
      tripsBudget: zero,
      tripsCommitted: zero,
      shortfall: toDbAmount(positive(money(input.confirmedTripsMonthly))),
      notes: [`Sem excedente ${period}: nada a dividir por enquanto.`],
    };
  }

  // 1. Reserva de emergência.
  const reserve = toCents(
    min(positive(money(input.reserveMissing)), available.times(ALLOCATION_RULES.reserveShare)),
  );
  let rest = available.minus(reserve);
  if (reserve.gt(0))
    notes.push(`Primeiro a reserva de emergência: ${formatMoney(reserve, currency)} por mês.`);

  // 2. Dívidas caras.
  const debt = toCents(
    min(positive(money(input.expensiveDebtBalance)), rest.times(ALLOCATION_RULES.debtShare)),
  );
  rest = rest.minus(debt);
  if (debt.gt(0)) {
    notes.push(
      `Quitar as dívidas caras rende mais que investir: ${formatMoney(debt, currency)} por mês para elas.`,
    );
  }

  // 3. Aposentadoria.
  let retirement = money(0);
  if (input.retirementRequired === null) {
    notes.push("Complete o plano de aposentadoria para receber quanto guardar.");
  } else {
    const required = positive(money(input.retirementRequired));
    retirement = toCents(min(required, rest.times(ALLOCATION_RULES.retirementShare)));
    if (retirement.lt(required)) {
      notes.push(
        `Para a aposentadoria cabem ${formatMoney(retirement, currency)} por mês, menos que os ` +
          `${formatMoney(required, currency)} necessários; a projeção mostra em que ano fecha com este valor.`,
      );
    }
  }
  rest = rest.minus(retirement);

  // 4. Metas e viagens, meio a meio. As viagens confirmadas saem da metade das viagens.
  const goalsBudget = toCents(rest.times(ALLOCATION_RULES.goalsShare));
  const tripsHalf = rest.minus(goalsBudget);
  const confirmed = positive(toCents(input.confirmedTripsMonthly));
  const tripsBudget = positive(tripsHalf.minus(confirmed));
  const shortfall = positive(confirmed.minus(tripsHalf));
  if (shortfall.gt(0)) {
    notes.push(
      `As viagens confirmadas pedem ${formatMoney(shortfall, currency)} por mês a mais do que sobra para viagens.`,
    );
  }

  return {
    reserve: toDbAmount(reserve),
    debt: toDbAmount(debt),
    retirement: toDbAmount(retirement),
    goalsBudget: toDbAmount(goalsBudget),
    tripsBudget: toDbAmount(tripsBudget),
    tripsCommitted: toDbAmount(tripsHalf.minus(tripsBudget)),
    shortfall: toDbAmount(shortfall),
    notes,
  };
}
