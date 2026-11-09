// Rescisão estimada de uma renda CLT (ADR-0031): o que a pessoa levaria se saísse numa data. É só
// informativo, recalculado a cada dia, até a família clicar em Lançar. Puro: recebe a tabela fiscal.
// Fontes e limites no ADR-0031. Não substitui o TRCT da empresa.
import { daysInMonth, yearMonthOf, type YearMonth } from "./cashflow";
import { addDays } from "./income-plan";
import { inssContribution, withholdingTax, type FiscalTable, type PayrollInput } from "./income";
import { money, toCents, toDbAmount } from "./money";

export const SEVERANCE_REASONS = ["sem_justa_causa", "pedido", "acordo"] as const;
export type SeveranceReason = (typeof SEVERANCE_REASONS)[number];

/** FGTS do empregador: 8% da remuneração (Lei 8.036/1990, art. 15). */
export const FGTS_RATE = "0.08";
/** Multa sobre o saldo do FGTS: 40% na dispensa sem justa causa (art. 18, § 1º), 20% no acordo (CLT, art. 484-A). */
export const FGTS_FINE_RATE: Record<SeveranceReason, string> = {
  sem_justa_causa: "0.40",
  acordo: "0.20",
  pedido: "0",
};
/** Aviso prévio: 30 dias mais 3 por ano completo, até 90 (Lei 12.506/2011, art. 1º). */
export const NOTICE_BASE_DAYS = 30;
export const NOTICE_DAYS_PER_YEAR = 3;
export const NOTICE_MAX_DAYS = 90;

export interface SeveranceInput extends PayrollInput {
  /** Início do contrato. Sem ele, avos e FGTS ficam estimados pelo ano corrente, com aviso. */
  jobStartedOn: string | null;
  /** Último dia trabalhado, hoje por padrão. */
  exitDate: string;
  reason: SeveranceReason;
  /** Aviso prévio indenizado (pago sem trabalhar). Só conta na dispensa e no acordo. */
  noticeIndemnified: boolean;
  /** Adiantamento do 13º já recebido no ano, a descontar. */
  thirteenthAdvancePaid: string;
  /** Saldo do FGTS informado pela família; nulo estima 8% dos meses de serviço. */
  fgtsBalance: string | null;
}

export interface SeveranceLine {
  gross: string;
  inss: string;
  tax: string;
  net: string;
}

export type SeveranceNote = "sem_inicio" | "ferias_vencidas_fora" | "pedido_sem_fgts";

export interface Severance {
  exitDate: string;
  /** Data projetada pelo aviso indenizado, que conta para 13º e férias (CLT, art. 487, § 1º). */
  projectedEnd: string;
  monthsOfService: number;
  fullYears: number;
  salaryBalance: SeveranceLine & { days: number };
  notice: { days: number; amount: string };
  thirteenth: SeveranceLine & { twelfths: number; advanceDeducted: string };
  vacation: { twelfths: number; proportional: string; oneThird: string; amount: string };
  fgts: { balance: string; estimated: boolean; fine: string; withdrawable: string };
  /** Saldo de salário + aviso + 13º + férias, líquidos. O FGTS fica à parte: é saque, não pagamento da empresa. */
  total: string;
  notes: SeveranceNote[];
}

/** Mês com 15 dias ou mais de serviço conta inteiro (Lei 4.090/1962, art. 1º, § 2º; CLT, art. 146, par. único). */
function twelfthsBetween(from: string, to: string): number {
  if (to < from) return 0;
  let count = 0;
  let month = yearMonthOf(from);
  const last = yearMonthOf(to);
  while (month <= last) {
    const first = month === yearMonthOf(from) ? Number(from.slice(8, 10)) : 1;
    const end = month === last ? Number(to.slice(8, 10)) : daysInMonth(month);
    if (end - first + 1 >= 15) count += 1;
    month = nextMonth(month);
  }
  return Math.min(12, count);
}

function nextMonth(month: YearMonth): YearMonth {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
}

function monthsBetween(from: string, to: string): number {
  if (to < from) return 0;
  const months =
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
  return Number(to.slice(8, 10)) >= Number(from.slice(8, 10)) ? months + 1 : months;
}

/** Último aniversário do contrato até a data: início do período aquisitivo das férias em curso. */
function acquisitiveStart(jobStartedOn: string, date: string): string {
  const year = Number(date.slice(0, 4));
  const candidate = `${year}${jobStartedOn.slice(4)}`;
  return candidate <= date ? candidate : `${year - 1}${jobStartedOn.slice(4)}`;
}

export function noticeDays(fullYears: number): number {
  return Math.min(
    NOTICE_MAX_DAYS,
    NOTICE_BASE_DAYS + NOTICE_DAYS_PER_YEAR * Math.max(0, fullYears),
  );
}

/**
 * Estimativa da rescisão. Saldo de salário e 13º proporcional pagam INSS e IR (o 13º com imposto
 * exclusivo, como no fim do ano); aviso indenizado e férias indenizadas com 1/3 são isentos
 * (Lei 7.713/1988, art. 6º, V; Súmula 386 do STJ). Faltas, horas extras, adicionais e médias não entram.
 */
export function calculateSeverance(input: SeveranceInput, table: FiscalTable): Severance {
  const notes: SeveranceNote[] = [];
  const gross = money(input.gross);
  const daily = gross.dividedBy(30);
  const { exitDate } = input;
  const year = Number(exitDate.slice(0, 4));
  const started = input.jobStartedOn && input.jobStartedOn <= exitDate ? input.jobStartedOn : null;
  if (!started) notes.push("sem_inicio");

  const monthsOfService = started ? monthsBetween(started, exitDate) : 0;
  const fullYears = started
    ? Math.floor(Math.max(0, monthsBetween(started, exitDate) - 1) / 12)
    : 0;

  // Aviso prévio: indenizado conta como tempo de serviço; no acordo, metade (CLT, art. 484-A, I, a).
  const noticeApplies = input.reason !== "pedido" && input.noticeIndemnified;
  const baseNoticeDays = noticeApplies ? noticeDays(fullYears) : 0;
  const paidNoticeDays = input.reason === "acordo" ? Math.ceil(baseNoticeDays / 2) : baseNoticeDays;
  const noticeAmount = toDbAmount(toCents(daily.times(paidNoticeDays)));
  const projectedEnd = noticeApplies ? addDays(exitDate, baseNoticeDays) : exitDate;

  // Saldo de salário: dias do mês da saída, pela convenção de 30 dias.
  const daysWorked = Math.min(30, Number(exitDate.slice(8, 10)));
  const balanceGross = toDbAmount(toCents(daily.times(daysWorked)));
  const balanceInss = inssContribution(balanceGross, table);
  const balanceTax = withholdingTax(
    {
      income: balanceGross,
      inss: balanceInss,
      dependents: input.dependents,
      pension: input.pension,
    },
    table,
  ).tax;
  const salaryBalance = {
    days: daysWorked,
    gross: balanceGross,
    inss: balanceInss,
    tax: balanceTax,
    net: toDbAmount(money(balanceGross).minus(balanceInss).minus(balanceTax)),
  };

  // 13º proporcional do ano da saída, com a projeção do aviso.
  const yearStart = `${year}-01-01`;
  const thirteenthFrom = started && started > yearStart ? started : yearStart;
  const projectedInYear =
    projectedEnd.slice(0, 4) === String(year) ? projectedEnd : `${year}-12-31`;
  const thirteenthTwelfths = twelfthsBetween(thirteenthFrom, projectedInYear);
  const thirteenthGross = toDbAmount(toCents(gross.times(thirteenthTwelfths).dividedBy(12)));
  const thirteenthInss = inssContribution(thirteenthGross, table);
  const thirteenthTax = withholdingTax(
    {
      income: thirteenthGross,
      inss: thirteenthInss,
      dependents: input.dependents,
      pension: input.pension,
    },
    table,
  ).tax;
  const advance = money(input.thirteenthAdvancePaid || "0");
  const thirteenthNet = money(thirteenthGross)
    .minus(thirteenthInss)
    .minus(thirteenthTax)
    .minus(advance);
  const thirteenth = {
    twelfths: thirteenthTwelfths,
    gross: thirteenthGross,
    inss: thirteenthInss,
    tax: thirteenthTax,
    advanceDeducted: toDbAmount(advance),
    net: toDbAmount(thirteenthNet.lt(0) ? money(0) : thirteenthNet),
  };

  // Férias proporcionais do período aquisitivo em curso, com 1/3. Férias vencidas não tiradas ficam fora.
  const vacationFrom = started ? acquisitiveStart(started, exitDate) : yearStart;
  const vacationTwelfths = twelfthsBetween(vacationFrom, projectedEnd);
  const proportional = toCents(gross.times(vacationTwelfths).dividedBy(12));
  const oneThird = toCents(proportional.dividedBy(3));
  const vacation = {
    twelfths: vacationTwelfths,
    proportional: toDbAmount(proportional),
    oneThird: toDbAmount(oneThird),
    amount: toDbAmount(proportional.plus(oneThird)),
  };
  if (started) notes.push("ferias_vencidas_fora");

  // FGTS: saldo informado ou estimado em 8% por mês de serviço; multa e saque dependem do motivo.
  const estimated = input.fgtsBalance === null;
  const balance = estimated
    ? toDbAmount(toCents(gross.times(FGTS_RATE).times(monthsOfService)))
    : toDbAmount(input.fgtsBalance!);
  const fine = toDbAmount(toCents(money(balance).times(FGTS_FINE_RATE[input.reason])));
  const withdrawable =
    input.reason === "sem_justa_causa"
      ? toDbAmount(money(balance).plus(fine))
      : input.reason === "acordo"
        ? toDbAmount(toCents(money(balance).times("0.8")).plus(fine))
        : "0.00";
  if (input.reason === "pedido") notes.push("pedido_sem_fgts");

  const total = toDbAmount(
    money(salaryBalance.net).plus(noticeAmount).plus(thirteenth.net).plus(vacation.amount),
  );
  return {
    exitDate,
    projectedEnd,
    monthsOfService,
    fullYears,
    salaryBalance,
    notice: { days: paidNoticeDays, amount: noticeAmount },
    thirteenth,
    vacation,
    fgts: { balance, estimated, fine, withdrawable },
    total,
    notes,
  };
}
