// Renda: bruto para líquido (CLT), 13º, férias e previsões do mês. Puro.
// As tabelas mudam todo ano e vêm como dados (fiscal_parameters); fontes no ADR-0009.
// É estimativa: o holerite real tem verbas que o sistema não conhece.
import { brazilRulesApply } from "./brazil-rules";
import {
  addMonths,
  occurrenceDate,
  yearMonthOf,
  type ScheduledEntry,
  type YearMonth,
} from "./cashflow";
import {
  inheritedFrom,
  planForYear,
  remainingVacationDays,
  serviceMonths,
  vacationEvents,
  VACATION_DAYS,
  type IncomeYearPlan,
  type ThirteenthMode,
  type VacationEvent,
  type VacationPart,
} from "./income-plan";
import { money, toCents, toDbAmount, type Currency, type MoneyValue } from "./money";

export interface FiscalTable {
  validFrom: YearMonth;
  minimumWage: string;
  /** Faixas progressivas: cada alíquota vale só para a parte do salário dentro da faixa. */
  inss: Array<{ upTo: string; rate: string }>;
  /** `upTo` nulo é a última faixa. */
  irrf: Array<{ upTo: string | null; rate: string; deduction: string }>;
  dependentDeduction: string;
  simplifiedDeduction: string;
  /** Redução da Lei 15.270/2025. */
  reduction: {
    fullUpTo: string;
    maxAmount: string;
    phaseOutUpTo: string;
    base: string;
    factor: string;
  };
}

/** Tabela em vigor no mês; sem tabela nova publicada, segue a mais recente. */
export function fiscalTableFor(tables: FiscalTable[], month: YearMonth): FiscalTable {
  const sorted = [...tables].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const table = sorted.filter((t) => t.validFrom <= month).at(-1) ?? sorted[0];
  if (!table) throw new Error("Nenhuma tabela fiscal cadastrada.");
  return table;
}

/** INSS do empregado, progressivo por faixa e limitado ao teto. */
export function inssContribution(gross: string, table: FiscalTable): string {
  const salary = money(gross);
  let floor = money(0);
  let total = money(0);
  for (const bracket of table.inss) {
    const ceiling = money(bracket.upTo);
    const top = salary.lt(ceiling) ? salary : ceiling;
    if (top.lte(floor)) break;
    total = total.plus(top.minus(floor).times(bracket.rate));
    floor = ceiling;
  }
  return toDbAmount(total);
}

/** Imposto pela tabela mensal, antes da redução. */
export function progressiveTax(base: string, table: FiscalTable): string {
  const value = money(base);
  const bracket = table.irrf.find((b) => b.upTo === null || value.lte(b.upTo));
  if (!bracket) return "0.00";
  const tax = value.times(bracket.rate).minus(bracket.deduction);
  return toDbAmount(tax.gt(0) ? tax : 0);
}

/**
 * Redução da Lei 15.270/2025. A faixa olha os rendimentos tributáveis, não a base depois das
 * deduções, e o valor nunca passa do imposto calculado pela tabela.
 */
export function taxReduction(income: string, tax: string, table: FiscalTable): string {
  const { fullUpTo, maxAmount, phaseOutUpTo, base, factor } = table.reduction;
  const value = money(income);
  if (value.gt(phaseOutUpTo)) return "0.00";
  const reduction = value.lte(fullUpTo) ? money(maxAmount) : money(base).minus(value.times(factor));
  const positive: MoneyValue = reduction.gt(0) ? reduction : money(0);
  return toDbAmount(positive.gt(tax) ? tax : positive);
}

export interface WithholdingInput {
  /** Rendimentos tributáveis do pagamento. */
  income: string;
  inss: string;
  dependents: number;
  pension: string;
}

export interface Withholding {
  deduction: "legal" | "simplificado";
  deductionAmount: string;
  base: string;
  taxBeforeReduction: string;
  reduction: string;
  tax: string;
}

/** IR na fonte, usando o maior entre as deduções legais e o desconto simplificado. */
export function withholdingTax(
  input: WithholdingInput,
  table: FiscalTable,
  options: { applyReduction: boolean } = { applyReduction: true },
): Withholding {
  const legal = money(input.inss)
    .plus(money(table.dependentDeduction).times(input.dependents))
    .plus(input.pension);
  const simplified = money(table.simplifiedDeduction);
  const useLegal = legal.gte(simplified);
  const deductionAmount = useLegal ? legal : simplified;
  const remainder = money(input.income).minus(deductionAmount);
  const base = toDbAmount(remainder.gt(0) ? remainder : 0);
  const taxBeforeReduction = progressiveTax(base, table);
  const reduction = options.applyReduction
    ? taxReduction(input.income, taxBeforeReduction, table)
    : "0.00";
  return {
    deduction: useLegal ? "legal" : "simplificado",
    deductionAmount: toDbAmount(deductionAmount),
    base,
    taxBeforeReduction,
    reduction,
    tax: toDbAmount(money(taxBeforeReduction).minus(reduction)),
  };
}

export interface PayrollInput {
  gross: string;
  dependents: number;
  /** Pensão alimentícia judicial: reduz a base do imposto. */
  pension: string;
  /** Outros descontos, como plano de saúde e vale: saem do líquido, sem reduzir o imposto. */
  otherDiscounts: string;
}

export interface Payslip extends Withholding {
  gross: string;
  inss: string;
  pension: string;
  otherDiscounts: string;
  net: string;
}

function payslip(
  input: PayrollInput,
  gross: string,
  otherDiscounts: string,
  table: FiscalTable,
  options?: { applyReduction: boolean },
  inss: string = inssContribution(gross, table),
): Payslip {
  const withholding = withholdingTax(
    { income: gross, inss, dependents: input.dependents, pension: input.pension },
    table,
    options,
  );
  return {
    ...withholding,
    gross: toDbAmount(gross),
    inss,
    pension: toDbAmount(input.pension),
    otherDiscounts: toDbAmount(otherDiscounts),
    net: toDbAmount(
      money(gross).minus(inss).minus(withholding.tax).minus(input.pension).minus(otherDiscounts),
    ),
  };
}

/** Holerite estimado de um mês normal. */
export function calculatePayslip(input: PayrollInput, table: FiscalTable): Payslip {
  return payslip(input, input.gross, input.otherDiscounts, table);
}

export interface ThirteenthSalary {
  gross: string;
  /** Adiantamento sem descontos, pago até 30/11. */
  firstInstallment: string;
  /** Pago até 20/12, já com os descontos do 13º inteiro. */
  secondInstallment: string;
  inss: string;
  tax: string;
  pension: string;
  net: string;
}

/**
 * 13º de um ano inteiro de trabalho. INSS e IR ficam na 2ª parcela. O IR é exclusivo na fonte,
 * separado do salário, com a redução (Lei 15.270/2025, § 3º) e a mesma escolha de deduções
 * (Perguntas e Respostas IRPF 2026, pergunta 332).
 */
export function calculateThirteenth(input: PayrollInput, table: FiscalTable): ThirteenthSalary {
  const slip = payslip(input, input.gross, "0", table);
  const first = toCents(money(input.gross).dividedBy(2));
  return {
    gross: slip.gross,
    firstInstallment: toDbAmount(first),
    secondInstallment: toDbAmount(money(slip.net).minus(first)),
    inss: slip.inss,
    tax: slip.tax,
    pension: slip.pension,
    net: slip.net,
  };
}

export interface VacationPay {
  /** Salário + 1/3. */
  gross: string;
  oneThird: string;
  inss: string;
  /** Sem a redução: é o valor usado nas previsões, por ser o menor. */
  tax: string;
  net: string;
  /** Se a redução também valer para férias. */
  taxWithReduction: string;
  netWithReduction: string;
}

/**
 * Férias de 30 dias: salário + 1/3, sem salário normal no mês. A Receita ainda não publicou como
 * a redução se aplica às férias (ADR-0009), então o cálculo devolve os dois valores.
 */
export function calculateVacation(input: PayrollInput, table: FiscalTable): VacationPay {
  const oneThird = toCents(money(input.gross).dividedBy(3));
  const gross = toDbAmount(money(input.gross).plus(oneThird));
  const without = payslip(input, gross, input.otherDiscounts, table, { applyReduction: false });
  const withReduction = payslip(input, gross, input.otherDiscounts, table);
  return {
    gross,
    oneThird: toDbAmount(oneThird),
    inss: without.inss,
    tax: without.tax,
    net: without.net,
    taxWithReduction: withReduction.tax,
    netWithReduction: withReduction.net,
  };
}

export const INCOME_KINDS = [
  "clt",
  "pj_autonomo",
  "aposentadoria_pensao",
  "aluguel",
  "outro",
] as const;
export type IncomeKind = (typeof INCOME_KINDS)[number];

/** `ferias-2` e `ferias-3` são os períodos seguintes do ano (ADR-0028). */
export type IncomePart = "salario" | VacationPart | "13-1" | "13-2";

export interface IncomeSourceInput {
  id: string;
  name: string;
  kind: IncomeKind;
  /** Bruto na CLT; nos outros tipos, o valor que cai na conta. */
  amount: string;
  isGross: boolean;
  dependents: number;
  pensionAmount: string;
  otherDiscounts: string;
  vacationMonth: number | null;
  payDay: number;
  startMonth: YearMonth;
  endMonth: YearMonth | null;
  categoryId: string;
  accountId: string;
  /** Escolhas de 13º e férias, por ano. Ano sem escolha fica no padrão de `defaultIncomePlan`. */
  plans?: IncomeYearPlan[];
  /** 1ª parcela lançada, por ano: o valor do lançamento vale mais que qualquer conta. */
  firstPaid?: Record<number, string>;
}

export const incomeKey = (sourceId: string, month: YearMonth, part: IncomePart) =>
  `r:${sourceId}:${month}:${part}`;

const payrollOf = (source: IncomeSourceInput): PayrollInput => ({
  gross: source.amount,
  dependents: source.dependents,
  pension: source.pensionAmount,
  otherDiscounts: source.otherDiscounts,
});

export const isPayroll = (source: Pick<IncomeSourceInput, "kind" | "isGross">) =>
  source.kind === "clt" && source.isGross;

/** Fora das regras brasileiras não há tabela fiscal: o valor cadastrado é o que cai na conta. */
export const plainIncomes = <T extends { isGross: boolean }>(
  sources: T[],
  currency: Currency,
): T[] =>
  brazilRulesApply(currency) ? sources : sources.map((source) => ({ ...source, isGross: false }));

/** Reparte um total pelos dias sem perder centavo: arredonda o acumulado, não cada parte. */
export function splitByDays(total: string, days: number[], basis: number): string[] {
  let sum = 0;
  let before = money(0);
  return days.map((value) => {
    sum += value;
    const upTo = toCents(money(total).times(sum).dividedBy(basis));
    const part = upTo.minus(before);
    before = upTo;
    return toDbAmount(part);
  });
}

interface VacationAmounts {
  event: VacationEvent;
  /** Salário dos dias de férias. */
  salary: string;
  oneThird: string;
  /** Salário dos dias vendidos. Não vai para o INSS nem para o IR. */
  abono: string;
  /** Terço do abono: entra no IR (Cosit 209/2021), não no INSS (ADR-0028). */
  abonoThird: string;
}

/**
 * Os 30 dias do salário e do terço, repartidos entre períodos, venda e o que sobra. Assim 20 dias de
 * férias mais 10 vendidos somam exatamente um salário, centavo a centavo.
 */
function vacationAmounts(source: IncomeSourceInput, year: number): VacationAmounts[] {
  const plan = planForYear(source.plans, year, source.vacationMonth);
  const events = vacationEvents(plan, source.payDay, year);
  if (events.length === 0) return [];
  const shares = [...events.map((event) => event.days), plan.soldDays];
  const used = shares.reduce((sum, days) => sum + days, 0);
  const basis = Math.max(used, VACATION_DAYS);
  const parts = [...shares, basis - used];
  const salary = splitByDays(source.amount, parts, basis);
  const third = splitByDays(toDbAmount(money(source.amount).dividedBy(3)), parts, basis);
  const sold = events.length;
  return events.map((event, index) => ({
    event,
    salary: salary[index]!,
    oneThird: third[index]!,
    abono: index === 0 ? salary[sold]! : "0.00",
    abonoThird: index === 0 ? third[sold]! : "0.00",
  }));
}

interface LedgerSlice {
  event: VacationEvent;
  inss: string;
  pension: string;
  otherDiscounts: string;
}

interface MonthLedger {
  slices: LedgerSlice[];
  /** Quanto do salário sobra para os dias trabalhados, com seus descontos. */
  worked: Payslip;
  workedDays: number;
}

const sumOf = (values: string[]) => values.reduce((acc, value) => acc.plus(value), money(0));

/**
 * Um mês de folha: dias de férias e dias trabalhados somam 30, então nada fica sem pagar nem é pago
 * duas vezes. O INSS das férias é do mês a que elas se referem e soma com o salário daquele mês para as
 * faixas e o teto; o IR das férias é separado do salário (ADR-0028). Pensão e outros descontos do mês
 * são repartidos pelos dias, para não saírem duas vezes.
 */
function monthLedger(
  source: IncomeSourceInput,
  tables: FiscalTable[],
  month: YearMonth,
): MonthLedger {
  const table = fiscalTableFor(tables, month);
  const input = payrollOf(source);
  const year = Number(month.slice(0, 4));
  const inMonth = [year - 1, year].flatMap((planYear) =>
    vacationAmounts(source, planYear).flatMap((amounts) => {
      const { event } = amounts;
      const index = event.slices.findIndex((slice) => slice.month === month);
      if (index < 0) return [];
      const days = event.slices.map((slice) => slice.days);
      return [
        {
          event,
          days: days[index]!,
          salary: splitByDays(amounts.salary, days, event.days)[index]!,
          oneThird: splitByDays(amounts.oneThird, days, event.days)[index]!,
        },
      ];
    }),
  );

  let base = money(0);
  let charged = money(0);
  const slices = inMonth.map((slice) => {
    base = base.plus(slice.salary).plus(slice.oneThird);
    const total = money(inssContribution(toDbAmount(base), table));
    const inss = toDbAmount(total.minus(charged));
    charged = total;
    const share = (value: string) => toDbAmount(money(value).times(slice.days).dividedBy(30));
    return {
      event: slice.event,
      days: slice.days,
      salary: slice.salary,
      inss,
      pension: share(input.pension),
      otherDiscounts: share(input.otherDiscounts),
    };
  });

  const gross = toDbAmount(money(input.gross).minus(sumOf(slices.map((slice) => slice.salary))));
  const inss = toDbAmount(
    money(inssContribution(toDbAmount(base.plus(gross)), table)).minus(charged),
  );
  const rest = (value: string, part: "pension" | "otherDiscounts") =>
    toDbAmount(money(value).minus(sumOf(slices.map((slice) => slice[part]))));
  return {
    slices,
    worked: payslip(
      { ...input, pension: rest(input.pension, "pension") },
      gross,
      rest(input.otherDiscounts, "otherDiscounts"),
      table,
      undefined,
      inss,
    ),
    workedDays: 30 - slices.reduce((sum, slice) => sum + slice.days, 0),
  };
}

/** O salário do mês, só pelos dias trabalhados. Num mês sem férias, é o holerite normal. */
export const workedSalary = (source: IncomeSourceInput, tables: FiscalTable[], month: YearMonth) =>
  monthLedger(source, tables, month).worked;

export interface VacationPayout {
  part: VacationPart;
  start: string;
  end: string;
  keyMonth: YearMonth;
  payDate: string;
  days: number;
  soldDays: number;
  dayKnown: boolean;
  received: boolean;
  salary: string;
  oneThird: string;
  abono: string;
  abonoThird: string;
  /** Tudo o que este pagamento soma, antes dos descontos. */
  gross: string;
  inss: string;
  /** Sem a redução: é o valor usado nas previsões, por ser o menor (ADR-0009). */
  tax: string;
  net: string;
  taxWithReduction: string;
  netWithReduction: string;
}

/** O que cada período paga, com os descontos da parte dele em cada mês. */
export function vacationPayouts(
  source: IncomeSourceInput,
  tables: FiscalTable[],
  year: number,
): VacationPayout[] {
  const input = payrollOf(source);
  return vacationAmounts(source, year).map((amounts) => {
    const { event, salary, oneThird, abono, abonoThird } = amounts;
    const mine = event.slices.flatMap((slice) =>
      monthLedger(source, tables, slice.month).slices.filter(
        (row) => row.event.part === event.part && row.event.keyMonth === event.keyMonth,
      ),
    );
    const inss = toDbAmount(sumOf(mine.map((row) => row.inss)));
    const pension = toDbAmount(sumOf(mine.map((row) => row.pension)));
    const otherDiscounts = toDbAmount(sumOf(mine.map((row) => row.otherDiscounts)));
    const table = fiscalTableFor(tables, yearMonthOf(event.payDate));
    const income = toDbAmount(money(salary).plus(oneThird).plus(abonoThird));
    const gross = toDbAmount(money(income).plus(abono));
    const taxOf = (applyReduction: boolean) =>
      withholdingTax({ income, inss, dependents: input.dependents, pension }, table, {
        applyReduction,
      }).tax;
    const netOf = (tax: string) =>
      toDbAmount(money(gross).minus(inss).minus(tax).minus(pension).minus(otherDiscounts));
    const tax = taxOf(false);
    const taxWithReduction = taxOf(true);
    return {
      part: event.part,
      start: event.start,
      end: event.end,
      keyMonth: event.keyMonth,
      payDate: event.payDate,
      days: event.days,
      soldDays: event.soldDays,
      dayKnown: event.dayKnown,
      received: event.received,
      salary,
      oneThird,
      abono,
      abonoThird,
      gross,
      inss,
      tax,
      net: netOf(tax),
      taxWithReduction,
      netWithReduction: netOf(taxWithReduction),
    };
  });
}

export interface ThirteenthPayment {
  month: YearMonth;
  date: string;
  amount: string;
}

export interface ThirteenthPlan {
  mode: ThirteenthMode;
  serviceMonths: number;
  gross: string;
  inss: string;
  tax: string;
  pension: string;
  net: string;
  /** O que sai do líquido por já ter sido pago antes. */
  advance: string;
  /** Em `integral`, não existe. */
  first: (ThirteenthPayment & { received: boolean; withVacation: boolean }) | null;
  /** A 2ª parcela, ou o pagamento único. */
  second: ThirteenthPayment & { received: boolean };
}

/** Até 30/11 e 20/12 são os prazos da lei; em outro mês, o dia do salário. */
export const thirteenthDate = (month: YearMonth, payDay: number) =>
  month.endsWith("-11")
    ? `${month}-30`
    : month.endsWith("-12")
      ? `${month}-20`
      : occurrenceDate(payDay, month);

const monthOfYear = (year: number, month: number): YearMonth =>
  `${year}-${String(month).padStart(2, "0")}`;

/**
 * 13º do ano, com as escolhas da família. Fora do ano do início no emprego, é o ano inteiro. INSS e IR
 * saem do valor inteiro, na 2ª parcela ou no pagamento único. Null quando não há 13º naquele ano.
 */
export function thirteenthPlan(
  source: IncomeSourceInput,
  tables: FiscalTable[],
  year: number,
): ThirteenthPlan | null {
  const plan = planForYear(source.plans, year, source.vacationMonth);
  const months = serviceMonths(plan.jobStartedOn, year);
  if (months === 0) return null;
  const gross =
    months === 12 ? source.amount : toDbAmount(money(source.amount).times(months).dividedBy(12));
  const secondMonth = monthOfYear(year, plan.secondMonth);
  const secondDate = thirteenthDate(secondMonth, source.payDay);
  const whole = calculateThirteenth(
    { ...payrollOf(source), gross },
    fiscalTableFor(tables, secondMonth),
  );
  const shared = {
    mode: plan.thirteenthMode,
    serviceMonths: months,
    gross: whole.gross,
    inss: whole.inss,
    tax: whole.tax,
    pension: whole.pension,
    net: whole.net,
  };
  const paid = source.firstPaid?.[year];
  const informed = plan.firstAmount ?? whole.firstInstallment;
  const left = (advance: string) => toDbAmount(money(whole.net).minus(advance));
  if (plan.thirteenthMode === "integral") {
    // Trocar para "tudo de uma vez" não apaga o que já entrou como 1ª parcela.
    const advance = toDbAmount(paid ?? (plan.firstReceived ? informed : "0"));
    return {
      ...shared,
      advance,
      first: null,
      second: {
        month: secondMonth,
        date: secondDate,
        amount: left(advance),
        received: plan.singleReceived,
      },
    };
  }

  const advance = toDbAmount(paid ?? informed);
  // Com as férias só vale se elas forem pagas no ano e antes da 2ª parcela. Senão, fica o mês escolhido.
  const vacation = plan.withVacation
    ? vacationEvents(plan, source.payDay, year).find(
        (event) => event.payDate.startsWith(`${year}-`) && event.payDate < secondDate,
      )
    : undefined;
  const firstDate =
    vacation?.payDate ?? thirteenthDate(monthOfYear(year, plan.firstMonth), source.payDay);
  return {
    ...shared,
    advance,
    first: {
      month: yearMonthOf(firstDate),
      date: firstDate,
      amount: advance,
      received: plan.firstReceived,
      withVacation: vacation !== undefined,
    },
    second: { month: secondMonth, date: secondDate, amount: left(advance), received: false },
  };
}

/** O que a renda paga em um mês, sem tratar do que já foi recebido. */
export function monthIncome(
  source: IncomeSourceInput,
  tables: FiscalTable[],
  month: YearMonth,
): ScheduledEntry[] {
  // Férias do primeiro mês da renda, com início no dia 1 ou 2, são pagas no mês anterior.
  const before = month < source.startMonth;
  if (before && !(isPayroll(source) && addMonths(month, 1) === source.startMonth)) return [];
  if (source.endMonth !== null && month > source.endMonth) return [];

  const entry = (
    part: IncomePart,
    description: string,
    amount: string,
    date: string,
    keyMonth: YearMonth = month,
  ) => ({
    key: incomeKey(source.id, keyMonth, part),
    source: "renda" as const,
    id: source.id,
    kind: "receita" as const,
    description,
    amount,
    date,
    categoryId: source.categoryId,
    accountId: source.accountId,
  });
  const payDate = occurrenceDate(source.payDay, month);

  if (!isPayroll(source))
    return [entry("salario", source.name, toDbAmount(source.amount), payDate)];

  const year = Number(month.slice(0, 4));
  // Férias que começam em 1º ou 2 de janeiro são pagas em dezembro do ano anterior.
  const vacations = [year, year + 1]
    .flatMap((planYear) => vacationPayouts(source, tables, planYear))
    .filter((payout) => yearMonthOf(payout.payDate) === month && !payout.received)
    .filter((payout) => !before || yearMonthOf(payout.start) >= source.startMonth)
    .map((payout) =>
      entry(payout.part, `Férias · ${source.name}`, payout.net, payout.payDate, payout.keyMonth),
    );
  if (before) return vacations.filter((item) => money(item.amount).gt(0));
  const entries = [
    ...vacations,
    entry("salario", source.name, monthLedger(source, tables, month).worked.net, payDate),
  ];

  const thirteenth = thirteenthPlan(source, tables, year);
  if (thirteenth?.first?.month === month && !thirteenth.first.received)
    entries.push(
      entry(
        "13-1",
        `13º, 1ª parcela · ${source.name}`,
        thirteenth.first.amount,
        thirteenth.first.date,
      ),
    );
  if (thirteenth?.second.month === month && !thirteenth.second.received)
    entries.push(
      entry(
        "13-2",
        thirteenth.mode === "integral"
          ? `13º salário · ${source.name}`
          : `13º, 2ª parcela · ${source.name}`,
        thirteenth.second.amount,
        thirteenth.second.date,
      ),
    );
  // Desconto maior que o valor não vira previsão de receita negativa.
  return entries.filter((item) => money(item.amount).gt(0));
}

/** Acha a previsão pela chave. Nas férias, o mês da chave é o do início ou o da baixa, e não o do pagamento. */
export function findIncomeEntry(
  source: IncomeSourceInput,
  tables: FiscalTable[],
  keyMonth: YearMonth,
  part: string,
): ScheduledEntry | null {
  const key = incomeKey(source.id, keyMonth, part as IncomePart);
  const payout = isPayroll(source)
    ? vacationPayouts(source, tables, Number(keyMonth.slice(0, 4))).find(
        (row) => row.keyMonth === keyMonth && row.part === part,
      )
    : undefined;
  const month = payout ? yearMonthOf(payout.payDate) : keyMonth;
  return monthIncome(source, tables, month).find((entry) => entry.key === key) ?? null;
}

export interface VacationSalaryMonth {
  month: YearMonth;
  workedDays: number;
  net: string;
}

export interface IncomeYearView {
  plan: IncomeYearPlan;
  /** Ano de onde a escolha veio, quando o ano não tem a dele. */
  inheritedFrom: number | null;
  thirteenth: ThirteenthPlan | null;
  vacations: VacationPayout[];
  /** Meses com férias: o salário vem só pelos dias trabalhados. */
  salaryMonths: VacationSalaryMonth[];
  remainingDays: number;
}

/** O ano da renda para a tela e o assistente, com a mesma conta das previsões. */
export function incomeYearView(
  source: IncomeSourceInput,
  tables: FiscalTable[],
  year: number,
): IncomeYearView | null {
  if (!isPayroll(source)) return null;
  const plan = planForYear(source.plans, year, source.vacationMonth);
  const vacations = vacationPayouts(source, tables, year);
  const touched = [
    ...new Set(
      vacationEvents(plan, source.payDay, year).flatMap((event) =>
        event.slices.map((slice) => slice.month),
      ),
    ),
  ].sort();
  return {
    plan,
    inheritedFrom: inheritedFrom(source.plans, year),
    thirteenth: thirteenthPlan(source, tables, year),
    vacations,
    salaryMonths: touched.map((month) => {
      const ledger = monthLedger(source, tables, month);
      return { month, workedDays: ledger.workedDays, net: ledger.worked.net };
    }),
    remainingDays: plan.periods.length > 0 ? remainingVacationDays(plan) : 0,
  };
}

/**
 * Mês da primeira previsão. Se o pagamento deste mês já passou, a renda começa no mês seguinte:
 * o que já caiu na conta não pode virar previsão atrasada nem somar no saldo previsto.
 */
export function firstIncomeMonth(today: string, payDay: number): YearMonth {
  const month = today.slice(0, 7);
  return today > occurrenceDate(payDay, month) ? addMonths(month, 1) : month;
}

/** Previsões de renda entre dois meses, inclusive. */
export function incomeBetween(
  sources: IncomeSourceInput[],
  tables: FiscalTable[],
  from: YearMonth,
  to: YearMonth,
): ScheduledEntry[] {
  const entries: ScheduledEntry[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) {
    for (const source of sources) entries.push(...monthIncome(source, tables, month));
  }
  return entries;
}

type ReceiptRow = { incomeSourceId: string; month: string; part: string };

/**
 * Períodos de férias do ano com baixa. A baixa casa pelo mês da chave, nunca pela posição: período
 * novo antes do recebido, ou período recebido que saiu, não tiram a previsão de outro. Sem linha do
 * próprio ano e com um período só, a baixa do ano é dele mesmo em outro mês: quem nunca escolheu é a
 * única diferença para a conta anterior ao ADR-0028, que previa pagar as férias de novo.
 */
function vacationsWithReceipt(
  source: IncomeSourceInput,
  receipts: ReceiptRow[],
  year: number,
): Set<string> {
  const plan = planForYear(source.plans, year, source.vacationMonth);
  const events = vacationEvents(plan, source.payDay, year);
  const done = new Set<string>();
  let orphan = false;
  for (const receipt of receipts) {
    if (receipt.incomeSourceId !== source.id || !receipt.part.startsWith("ferias")) continue;
    if (!receipt.month.startsWith(`${year}-`)) continue;
    const open = events.filter((e) => e.keyMonth === receipt.month && !done.has(e.part));
    const match = open.find((e) => e.part === receipt.part) ?? open[0];
    if (match) done.add(match.part);
    else orphan = true;
  }
  const ownRow = source.plans?.some((row) => row.year === year) ?? false;
  if (orphan && !ownRow && events.length === 1) done.add(events[0]!.part);
  return done;
}

const THIRTEENTH_PARTS: readonly string[] = ["13-1", "13-2"];

/** Partes de 13º e férias já recebidas com lançamento naquele ano. */
export function receivedInYear(
  receipts: ReceiptRow[],
  source: IncomeSourceInput,
  year: number,
): string[] {
  const thirteenth = receipts
    .filter(
      (row) =>
        row.incomeSourceId === source.id &&
        THIRTEENTH_PARTS.includes(row.part) &&
        row.month.startsWith(`${year}-`),
    )
    .map((row) => row.part);
  return [...new Set(thirteenth), ...vacationsWithReceipt(source, receipts, year)];
}

/**
 * O que continua em aberto depois do que já foi recebido. A chave exata vale para todos. 13º é um por
 * ano, seja qual for o mês da baixa; férias seguem `vacationsWithReceipt`. Previsão nunca some sem
 * baixa real.
 */
export function openIncomeEntries(
  entries: ScheduledEntry[],
  receipts: ReceiptRow[],
  sources: IncomeSourceInput[],
): ScheduledEntry[] {
  const exact = new Set(
    receipts.map((row) => incomeKey(row.incomeSourceId, row.month, row.part as IncomePart)),
  );
  const byId = new Map(sources.map((source) => [source.id, source]));
  const known = new Map<string, string[]>();
  const receivedOf = (source: IncomeSourceInput, year: number) => {
    const key = `${source.id}:${year}`;
    const parts = known.get(key) ?? receivedInYear(receipts, source, year);
    known.set(key, parts);
    return parts;
  };
  return entries.filter((entry) => {
    if (exact.has(entry.key)) return false;
    const [, id = "", month = "", part = ""] = entry.key.split(":");
    const source = byId.get(id);
    if (part === "salario" || !source || !isPayroll(source)) return true;
    return !receivedOf(source, Number(month.slice(0, 4))).includes(part);
  });
}

/** Valor de um mês normal: líquido estimado na CLT, valor informado nos outros tipos. */
export function monthlyNet(source: IncomeSourceInput, tables: FiscalTable[], month: YearMonth) {
  return isPayroll(source)
    ? calculatePayslip(payrollOf(source), fiscalTableFor(tables, month)).net
    : toDbAmount(source.amount);
}
