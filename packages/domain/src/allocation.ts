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
  /** O que a família já investe por mês (`savingHabit`). Dinheiro que já saiu não é dividido de novo. */
  alreadyInvesting?: string;
  /** O que a família já paga por mês em parcelas de meta (`savingHabit`). */
  alreadySavingForGoals?: string;
  /** Meses de histórico, só para o texto da nota. */
  surplusMonths?: number;
  /** Moeda principal da família, para as notas. Sem ela, real. */
  currency?: Currency;
}

export interface Allocation {
  reserve: string;
  debt: string;
  /** Total por mês para investir, já contando `alreadyInvesting`. */
  retirement: string;
  /** Parte de `retirement` que a família já faz. O que sobra acima disso é o pedido novo. */
  alreadyInvesting: string;
  /** Total por mês para metas, já contando `alreadySavingForGoals`. */
  goalsBudget: string;
  /** Parte de `goalsBudget` que a família já paga. */
  alreadySavingForGoals: string;
  /** O que sobra para viagens novas depois das confirmadas. */
  tripsBudget: string;
  /** Parte do orçamento de viagens já tomada pelas confirmadas. */
  tripsCommitted: string;
  /** O que as viagens confirmadas pedem além do que sobra para viagens. */
  shortfall: string;
  /** O que a reserva pediria e não coube, porque o dinheiro já sai para investimentos e metas. */
  reserveShort: string;
  /** O mesmo, para as dívidas caras. */
  debtShort: string;
  /** Quanto do aporte de hoje cobriria o que ficou curto. Só informa: nada muda sozinho. */
  redirectable: string;
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
 *
 * O excedente vem antes dos aportes, e o hábito é dinheiro que de fato sai (ADR-0027). Por isso a divisão
 * reparte só o que resta depois dele, na mesma ordem, e nunca promete mais do que sobra de verdade. As
 * fatias que a ordem pediria são medidas sobre o disponível inteiro: assim quem segue a sugestão recebe a
 * mesma sugestão no mês seguinte. Quando reserva ou dívida ficam curtas por causa do hábito, `reserveShort`,
 * `debtShort` e as notas dizem isso. Redirecionar é decisão da família.
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
      alreadyInvesting: zero,
      goalsBudget: zero,
      alreadySavingForGoals: zero,
      tripsBudget: zero,
      tripsCommitted: zero,
      shortfall: toDbAmount(positive(money(input.confirmedTripsMonthly))),
      reserveShort: zero,
      debtShort: zero,
      redirectable: zero,
      notes: [`Sem excedente ${period}: nada a dividir por enquanto.`],
    };
  }

  // O que já sai todo mês: só o resto é repartido.
  const invested = min(positive(toCents(input.alreadyInvesting ?? 0)), available);
  const goalsPaid = min(
    positive(toCents(input.alreadySavingForGoals ?? 0)),
    available.minus(invested),
  );
  let free = available.minus(invested).minus(goalsPaid);
  const take = (wanted: MoneyValue) => {
    const part = min(wanted, free);
    free = free.minus(part);
    return part;
  };

  // O que a ordem pediria, sobre o disponível inteiro.
  const wantedReserve = toCents(
    min(positive(money(input.reserveMissing)), available.times(ALLOCATION_RULES.reserveShare)),
  );
  const afterReserve = available.minus(wantedReserve);
  const wantedDebt = toCents(
    min(
      positive(money(input.expensiveDebtBalance)),
      afterReserve.times(ALLOCATION_RULES.debtShare),
    ),
  );
  const afterDebt = afterReserve.minus(wantedDebt);
  const required =
    input.retirementRequired === null ? null : positive(money(input.retirementRequired));
  const wantedRetirement =
    required === null
      ? money(0)
      : toCents(min(required, afterDebt.times(ALLOCATION_RULES.retirementShare)));
  const wantedGoals = toCents(afterDebt.minus(wantedRetirement).times(ALLOCATION_RULES.goalsShare));

  // O que cabe, na mesma ordem. O que já é feito conta na fatia dele.
  const reserve = take(wantedReserve);
  const debt = take(wantedDebt);
  const retirement = invested.plus(take(positive(wantedRetirement.minus(invested))));
  const goalsBudget = goalsPaid.plus(take(positive(wantedGoals.minus(goalsPaid))));
  const tripsHalf = free;

  const reserveShort = wantedReserve.minus(reserve);
  const debtShort = wantedDebt.minus(debt);
  const redirectable = min(reserveShort.plus(debtShort), invested);
  const gone = invested.plus(goalsPaid);
  if (reserveShort.gt(0)) {
    notes.push(
      `A reserva de emergência pede ${formatMoney(wantedReserve, currency)} por mês, mas só cabem ` +
        `${formatMoney(reserve, currency)}: ${formatMoney(gone, currency)} já saem para investimentos e metas.`,
    );
  } else if (reserve.gt(0)) {
    notes.push(`Primeiro a reserva de emergência: ${formatMoney(reserve, currency)} por mês.`);
  }
  if (debtShort.gt(0)) {
    notes.push(
      `Quitar as dívidas caras pede ${formatMoney(wantedDebt, currency)} por mês, mas só cabem ` +
        `${formatMoney(debt, currency)}: ${formatMoney(gone, currency)} já saem para investimentos e metas.`,
    );
  } else if (debt.gt(0)) {
    notes.push(
      `Quitar as dívidas caras rende mais que investir: ${formatMoney(debt, currency)} por mês para elas.`,
    );
  }
  if (required === null) {
    notes.push("Complete o plano de aposentadoria para receber quanto guardar.");
  } else if (retirement.lt(required)) {
    notes.push(
      `Para a aposentadoria cabem ${formatMoney(retirement, currency)} por mês, menos que os ` +
        `${formatMoney(required, currency)} necessários; a projeção mostra em que ano fecha com este valor.`,
    );
  }
  if (invested.gt(0)) {
    notes.push(
      `Os ${formatMoney(invested, currency)} que já saem por mês para investimentos contam nesta divisão.`,
    );
  }
  if (goalsPaid.gt(0)) {
    notes.push(
      `Os ${formatMoney(goalsPaid, currency)} que já saem por mês para metas contam nesta divisão.`,
    );
  }

  // As viagens confirmadas saem do que restou para viagens.
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
    alreadyInvesting: toDbAmount(invested),
    goalsBudget: toDbAmount(goalsBudget),
    alreadySavingForGoals: toDbAmount(goalsPaid),
    tripsBudget: toDbAmount(tripsBudget),
    tripsCommitted: toDbAmount(tripsHalf.minus(tripsBudget)),
    shortfall: toDbAmount(shortfall),
    reserveShort: toDbAmount(reserveShort),
    debtShort: toDbAmount(debtShort),
    redirectable: toDbAmount(redirectable),
    notes,
  };
}
