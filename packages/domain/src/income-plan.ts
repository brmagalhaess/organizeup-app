// Escolhas de 13º e férias de uma renda CLT (ADR-0028): datas, dias e limites da lei, sem dinheiro. Puro.
// O cálculo em reais fica em `income.ts`.
import { daysInMonth, occurrenceDate, yearMonthOf, type YearMonth } from "./cashflow";

export const THIRTEENTH_MODES = ["parcelas", "integral"] as const;
export type ThirteenthMode = (typeof THIRTEENTH_MODES)[number];

/** Dias de férias de quem teve até 5 faltas (CLT, art. 130). */
export const VACATION_DAYS = 30;
/** Um terço de 30 dias (CLT, art. 143). */
export const MAX_SOLD_DAYS = 10;
/** CLT, art. 134, § 1º. */
export const MAX_VACATION_PERIODS = 3;
export const MIN_LONG_PERIOD = 14;
export const MIN_PERIOD = 5;

export const VACATION_PARTS = ["ferias", "ferias-2", "ferias-3"] as const;
export type VacationPart = (typeof VACATION_PARTS)[number];

export interface VacationPeriod {
  /** Mês do início, de 1 a 12. */
  month: number;
  /** Null: ainda não sabe. A previsão cai no dia do salário daquele mês. */
  startDay: number | null;
  days: number;
  /** Já recebido sem lançamento. */
  received: boolean;
  /** Mês da baixa, quando o período foi movido depois de recebido. Sem isso, é `month`. */
  keyMonth?: number;
}

/** O que a família escolheu, do ano `year` em diante. Dado informado: o agente nunca muda (regra 7). */
export interface IncomeYearPlan {
  year: number;
  thirteenthMode: ThirteenthMode;
  firstMonth: number;
  /** Em `integral`, o mês único. */
  secondMonth: number;
  withVacation: boolean;
  /** 1ª parcela já recebida sem lançamento. Em `integral`, é adiantamento a descontar. */
  firstReceived: boolean;
  /** Valor recebido da 1ª parcela. */
  firstAmount: string | null;
  /** Em `integral`, o pagamento único já recebido sem lançamento. */
  singleReceived: boolean;
  jobStartedOn: string | null;
  soldDays: number;
  periods: VacationPeriod[];
}

/** O que vale para quem nunca escolheu nada: o resultado de antes desta decisão. */
export function defaultIncomePlan(year: number, vacationMonth: number | null): IncomeYearPlan {
  return {
    year,
    thirteenthMode: "parcelas",
    firstMonth: 11,
    secondMonth: 12,
    withVacation: false,
    firstReceived: false,
    firstAmount: null,
    singleReceived: false,
    jobStartedOn: null,
    soldDays: 0,
    periods: vacationMonth
      ? [{ month: vacationMonth, startDay: null, days: VACATION_DAYS, received: false }]
      : [],
  };
}

/** A linha que vale no ano: a mais recente até ele. Escolher 2027 nunca muda 2026. */
const rowFor = (plans: IncomeYearPlan[] | undefined, year: number) =>
  (plans ?? []).filter((plan) => plan.year <= year).sort((a, b) => b.year - a.year)[0];

/**
 * Plano do ano. Sem linha própria, herda forma, meses, períodos e venda da linha anterior. O que
 * aconteceu é sempre do próprio ano: marcas de recebido, valor recebido e mês da baixa não passam adiante.
 */
export function planForYear(
  plans: IncomeYearPlan[] | undefined,
  year: number,
  vacationMonth: number | null,
): IncomeYearPlan {
  const chosen = rowFor(plans, year);
  if (!chosen) return defaultIncomePlan(year, vacationMonth);
  if (chosen.year === year) return chosen;
  return {
    ...chosen,
    year,
    firstReceived: false,
    firstAmount: null,
    singleReceived: false,
    periods: chosen.periods.map(({ keyMonth: _ignored, ...period }) => ({
      ...period,
      received: false,
    })),
  };
}

/** Ano da escolha herdada, ou null se o ano tem a dele ou nenhuma. */
export function inheritedFrom(plans: IncomeYearPlan[] | undefined, year: number): number | null {
  const chosen = rowFor(plans, year);
  return chosen && chosen.year < year ? chosen.year : null;
}

const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** Lê o jsonb do banco. O que não fizer sentido fica de fora, em vez de derrubar a previsão. */
export function parseVacationPeriods(value: unknown): VacationPeriod[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const row = (item ?? {}) as Record<string, unknown>;
    if (!isInt(row.month, 1, 12) || !isInt(row.days, 1, VACATION_DAYS)) return [];
    return [
      {
        month: row.month,
        startDay: isInt(row.startDay, 1, 31) ? row.startDay : null,
        days: row.days,
        received: row.received === true,
        ...(isInt(row.keyMonth, 1, 12) ? { keyMonth: row.keyMonth } : {}),
      },
    ];
  });
}

export function addDays(date: string, delta: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + delta)).toISOString().slice(0, 10);
}

export interface VacationSlice {
  month: YearMonth;
  days: number;
}

export interface VacationEvent {
  part: VacationPart;
  start: string;
  end: string;
  /** Mês da chave da previsão: o do início, mesmo com pagamento no mês anterior, ou o da baixa de um período movido. */
  keyMonth: YearMonth;
  payDate: string;
  days: number;
  /** Abono, pago com o 1º período. */
  soldDays: number;
  dayKnown: boolean;
  received: boolean;
  /** Dias corridos em cada mês. */
  slices: VacationSlice[];
}

const monthOf = (year: number, month: number): YearMonth =>
  `${year}-${String(month).padStart(2, "0")}`;

function slicesOf(start: string, days: number): VacationSlice[] {
  const slices: VacationSlice[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const month = yearMonthOf(addDays(start, offset));
    const last = slices.at(-1);
    if (last?.month === month) last.days += 1;
    else slices.push({ month, days: 1 });
  }
  return slices;
}

/** Períodos do ano com data de início, de fim e de pagamento, na ordem do calendário. */
export function vacationEvents(
  plan: IncomeYearPlan,
  payDay: number,
  year: number,
): VacationEvent[] {
  const ordered = [...plan.periods]
    .sort((a, b) => a.month - b.month || (a.startDay ?? 1) - (b.startDay ?? 1))
    .slice(0, MAX_VACATION_PERIODS);
  return ordered.map((period, index) => {
    const startMonth = monthOf(year, period.month);
    const dayKnown = period.startDay !== null;
    const start = occurrenceDate(period.startDay ?? 1, startMonth);
    return {
      part: VACATION_PARTS[index]!,
      start,
      end: addDays(start, period.days - 1),
      keyMonth: monthOf(year, period.keyMonth ?? period.month),
      // CLT, art. 145: até 2 dias antes do início. Sem o dia, segue o dia do salário.
      payDate: dayKnown ? addDays(start, -2) : occurrenceDate(payDay, startMonth),
      days: period.days,
      soldDays: index === 0 ? plan.soldDays : 0,
      dayKnown,
      received: period.received,
      // Sem o dia, o período fica inteiro no mês escolhido.
      slices: dayKnown ? slicesOf(start, period.days) : [{ month: startMonth, days: period.days }],
    };
  });
}

/** Lei 4.090/1962, art. 1º, §§ 1º e 2º: mês com 15 dias ou mais de trabalho conta inteiro. */
export function serviceMonths(jobStartedOn: string | null, year: number): number {
  if (!jobStartedOn) return 12;
  const startYear = Number(jobStartedOn.slice(0, 4));
  if (startYear < year) return 12;
  if (startYear > year) return 0;
  const startMonth = Number(jobStartedOn.slice(5, 7));
  const worked = daysInMonth(yearMonthOf(jobStartedOn)) - Number(jobStartedOn.slice(8, 10)) + 1;
  return 12 - startMonth + (worked >= 15 ? 1 : 0);
}

export type PlanIssueCode =
  | "too_many_periods"
  | "period_too_short"
  | "needs_long_period"
  | "days_over"
  | "sold_over"
  | "bad_sold"
  | "bad_month"
  | "overlap"
  | "bad_day"
  | "bad_period"
  | "first_after_second"
  | "bad_job_date";

export interface PlanIssue {
  code: PlanIssueCode;
  /** Linha do período, quando o erro é de um só. */
  index?: number;
}

const isRealDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Limites da CLT, arts. 134 e 143, e a ordem das parcelas. Vazio quando está tudo certo. */
export function validateIncomePlan(plan: IncomeYearPlan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const { periods } = plan;
  const months =
    isInt(plan.secondMonth, 1, 12) &&
    (plan.thirteenthMode === "integral" || isInt(plan.firstMonth, 2, 11)) &&
    periods.every((period) => isInt(period.month, 1, 12));
  // Mês fora da lista não vem da tela, e nada depois daqui faz sentido com ele.
  if (!months) return [{ code: "bad_month" }];
  if (periods.length > MAX_VACATION_PERIODS) issues.push({ code: "too_many_periods" });
  periods.forEach((period, index) => {
    if (!isInt(period.days, 1, VACATION_DAYS)) issues.push({ code: "bad_period", index });
    else if (period.days < MIN_PERIOD) issues.push({ code: "period_too_short", index });
    if (
      period.startDay !== null &&
      !isInt(period.startDay, 1, daysInMonth(monthOf(plan.year, period.month)))
    )
      issues.push({ code: "bad_day", index });
  });
  if (periods.length > 0 && !periods.some((period) => period.days >= MIN_LONG_PERIOD))
    issues.push({ code: "needs_long_period" });

  const taken = periods.reduce((sum, period) => sum + period.days, 0);
  if (!Number.isInteger(plan.soldDays) || plan.soldDays < 0) issues.push({ code: "bad_sold" });
  else if (plan.soldDays > MAX_SOLD_DAYS) issues.push({ code: "sold_over" });
  else if (taken + plan.soldDays > VACATION_DAYS) issues.push({ code: "days_over" });

  if (issues.length === 0 && overlaps(plan)) issues.push({ code: "overlap" });

  if (plan.thirteenthMode === "parcelas" && plan.firstMonth >= plan.secondMonth)
    issues.push({ code: "first_after_second" });
  if (plan.jobStartedOn !== null && !isRealDate(plan.jobStartedOn))
    issues.push({ code: "bad_job_date" });
  return issues;
}

function overlaps(plan: IncomeYearPlan): boolean {
  const events = vacationEvents(plan, 1, plan.year);
  const dated = events.filter((event) => event.dayKnown);
  if (dated.some((event, index) => index > 0 && event.start <= dated[index - 1]!.end)) return true;
  // Com período sem dia, olha só se o mês comporta tudo: mais de 30 dias nele deixaria salário negativo.
  const byMonth = new Map<string, number>();
  for (const event of events)
    for (const slice of event.slices)
      byMonth.set(slice.month, (byMonth.get(slice.month) ?? 0) + slice.days);
  return [...byMonth.values()].some((days) => days > VACATION_DAYS);
}

/**
 * Marca "Já recebi" só onde o pagamento já passou. A marca é da data, não do período: mudar férias
 * recebidas de julho para dezembro não pode tirar dezembro da previsão.
 */
export function settleReceived(
  plan: IncomeYearPlan,
  payDay: number,
  today: string,
): IncomeYearPlan {
  const future = plan.year > Number(today.slice(0, 4));
  return {
    ...plan,
    firstReceived: plan.firstReceived && !future,
    singleReceived: plan.singleReceived && !future,
    periods: plan.periods.map((period) => {
      const event = vacationEvents({ ...plan, periods: [period] }, payDay, plan.year)[0];
      return {
        ...period,
        received: period.received && event !== undefined && event.payDate < today,
      };
    }),
  };
}

/**
 * Leva a baixa junto quando um período recebido muda de mês. O mês igual casa primeiro. O que sobrou de
 * um lado e do outro é período movido, e o novo fica com o mês da baixa. Período que só saiu não passa
 * a baixa para ninguém: sem período sobrando, nenhum outro herda. `receivedMonths` traz "01" a "12".
 */
export function carryVacationKeys(
  previous: IncomeYearPlan,
  next: IncomeYearPlan,
  receivedMonths: ReadonlySet<string>,
): IncomeYearPlan {
  const pool = previous.periods.map((period) => ({
    month: period.month,
    key: period.keyMonth ?? period.month,
  }));
  const periods = next.periods.map(({ keyMonth: _ignored, ...period }): VacationPeriod => period);
  const free: number[] = [];
  periods.forEach((period, index) => {
    const found = pool.findIndex((old) => old.month === period.month);
    if (found < 0) {
      free.push(index);
      return;
    }
    const [old] = pool.splice(found, 1);
    if (old!.key !== period.month) period.keyMonth = old!.key;
  });
  const received = pool.filter((old) => receivedMonths.has(String(old.key).padStart(2, "0")));
  for (const index of free) {
    const old = received.shift();
    if (old) periods[index]!.keyMonth = old.key;
  }
  return { ...next, periods };
}

/** Dias de férias que ainda não têm período nem foram vendidos. Aviso, nunca erro: faltas reduzem as férias. */
export function remainingVacationDays(plan: IncomeYearPlan): number {
  const taken = plan.periods.reduce((sum, period) => sum + period.days, 0);
  return Math.max(0, VACATION_DAYS - taken - plan.soldDays);
}
