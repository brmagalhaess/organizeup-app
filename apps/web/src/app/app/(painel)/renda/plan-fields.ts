// Campos do formulário de 13º e férias para o plano do domínio. A mesma função serve à conta ao vivo no
// navegador e à gravação no servidor: o que a tela mostra é o que fica salvo.
import type { IncomeYearPlan, ThirteenthMode } from "@organizeup/domain";

export interface PeriodFields {
  month: string;
  day: string;
  days: string;
  received: boolean;
}

export interface PlanFields {
  mode: ThirteenthMode;
  firstMonth: string;
  secondMonth: string;
  singleMonth: string;
  withVacation: boolean;
  firstReceived: boolean;
  /** Já em formato do banco, ou null. */
  firstAmount: string | null;
  singleReceived: boolean;
  jobStartedOn: string;
  sell: boolean;
  soldDays: string;
  periods: PeriodFields[];
}

const whole = (value: string) => (value.trim() === "" ? NaN : Number(value));

export function planFromFields(fields: PlanFields, year: number): IncomeYearPlan {
  const periods = fields.periods
    .filter((period) => Number(period.month) > 0)
    .map((period) => ({
      month: Number(period.month),
      startDay: period.day.trim() === "" ? null : whole(period.day),
      days: whole(period.days),
      received: period.received,
    }));
  const hasVacation = periods.length > 0;
  const integral = fields.mode === "integral";
  return {
    year,
    thirteenthMode: fields.mode,
    firstMonth: Number(fields.firstMonth) || 11,
    secondMonth: Number(integral ? fields.singleMonth : fields.secondMonth),
    withVacation: !integral && hasVacation && fields.withVacation,
    // A marca da 1ª não se perde em "tudo de uma vez": o valor sai desse pagamento.
    firstReceived: fields.firstReceived,
    firstAmount: fields.firstAmount,
    singleReceived: integral && fields.singleReceived,
    jobStartedOn: fields.jobStartedOn.trim() || null,
    soldDays: hasVacation && fields.sell ? whole(fields.soldDays) : 0,
    periods,
  };
}

/** Compara o que muda a previsão, sem depender da ordem das chaves. */
export function samePlan(a: IncomeYearPlan, b: IncomeYearPlan): boolean {
  const shape = (plan: IncomeYearPlan) =>
    JSON.stringify([
      plan.thirteenthMode,
      // Em "integral", o mês da 1ª não conta.
      plan.thirteenthMode === "integral" ? 0 : plan.firstMonth,
      plan.secondMonth,
      plan.withVacation,
      plan.firstReceived,
      plan.firstAmount,
      plan.singleReceived,
      plan.jobStartedOn,
      plan.soldDays,
      [...plan.periods]
        .sort((x, y) => x.month - y.month || (x.startDay ?? 1) - (y.startDay ?? 1))
        .map((p) => [p.month, p.startDay, p.days, p.received]),
    ]);
  return shape(a) === shape(b);
}
