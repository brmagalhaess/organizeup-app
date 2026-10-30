// Planejamento de viagens. Puro: os custos vêm da família, e aqui só sai quanto guardar por mês.
import { addMonths, yearMonthOf } from "./cashflow";
import { money, toDbAmount } from "./money";

export interface TripCostInput {
  amount: string;
  perPerson: boolean;
}

export interface TripInput {
  startOn: string;
  saved: string;
  travelers: number;
  costs: TripCostInput[];
}

export interface TripPlan {
  total: string;
  perTraveler: string;
  missing: string;
  /** 0 a 100 do total. */
  percent: number;
  /** Meses para guardar, contando o atual e sem contar o da viagem. */
  monthsLeft: number;
  /** Quanto guardar por mês. Null se a data já passou. */
  monthly: string | null;
  past: boolean;
}

export function monthsBetween(from: string, to: string): number {
  let months = 0;
  for (let ym = from; ym < to && months < 1200; ym = addMonths(ym, 1)) months += 1;
  return months;
}

export function planTrip(trip: TripInput, today: string): TripPlan {
  const travelers = Math.max(1, trip.travelers);
  const total = trip.costs.reduce(
    (acc, cost) => acc.plus(money(cost.amount).times(cost.perPerson ? travelers : 1)),
    money(0),
  );
  const missing = total.minus(trip.saved);
  const left = missing.gt(0) ? missing : money(0);
  const past = trip.startOn < today;
  const monthsLeft = past ? 0 : monthsBetween(yearMonthOf(today), yearMonthOf(trip.startOn));
  return {
    total: toDbAmount(total),
    perTraveler: toDbAmount(total.dividedBy(travelers)),
    missing: toDbAmount(left),
    percent: total.isZero()
      ? 0
      : Math.min(100, money(trip.saved).dividedBy(total).times(100).toDecimalPlaces(0).toNumber()),
    monthsLeft,
    monthly: past ? null : toDbAmount(left.dividedBy(Math.max(1, monthsLeft))),
    past,
  };
}
