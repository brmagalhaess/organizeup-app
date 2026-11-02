// Campos do formulário de 13º e férias para o plano do domínio. A mesma função serve à conta ao vivo no
// navegador e à gravação no servidor: o que a tela mostra é o que fica salvo.
import {
  carryVacationKeys,
  orphanVacationMonths,
  receivedInYear,
  type IncomeSourceInput,
  type IncomeYearPlan,
  type ThirteenthMode,
} from "@organizeup/domain";

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
    // A marca do pagamento único também não se perde: o 13º já está quitado.
    singleReceived: fields.singleReceived,
    jobStartedOn: fields.jobStartedOn.trim() || null,
    soldDays: hasVacation && fields.sell ? whole(fields.soldDays) : 0,
    periods,
  };
}

type ReceiptRow = { incomeSourceId: string; month: string; part: string };

/** Meses das baixas de férias do ano, de "01" a "12". */
export const vacationReceiptMonths = (receipts: ReceiptRow[], year: number) =>
  new Set(
    receipts
      .filter((row) => row.part.startsWith("ferias") && row.month.startsWith(`${year}-`))
      .map((row) => row.month.slice(5)),
  );

/**
 * Baixas como vão ficar depois de salvar: leva a baixa do período movido e casa pelo mês da chave, com
 * a mesma regra do servidor. Assim a prévia não diz "Recebida" em outro período.
 */
export function previewReceipts(
  sourceId: string,
  saved: IncomeYearPlan,
  built: IncomeYearPlan,
  receipts: ReceiptRow[],
) {
  const mine = receipts.filter((row) => row.incomeSourceId === sourceId);
  const plan = carryVacationKeys(saved, built, vacationReceiptMonths(mine, built.year));
  const source = {
    id: sourceId,
    kind: "clt",
    isGross: true,
    vacationMonth: null,
    payDay: 1,
    plans: [plan],
  } as unknown as IncomeSourceInput;
  return {
    plan,
    parts: receivedInYear(mine, source, built.year),
    orphans: orphanVacationMonths(mine, source, built.year),
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
