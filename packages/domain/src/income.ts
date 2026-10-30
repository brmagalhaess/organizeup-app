// Renda: bruto para líquido (CLT), 13º, férias e previsões do mês. Puro.
// As tabelas mudam todo ano e vêm como dados (fiscal_parameters); fontes no ADR-0009.
// É estimativa: o holerite real tem verbas que o sistema não conhece.
import { addMonths, occurrenceDate, type ScheduledEntry, type YearMonth } from "./cashflow";
import { money, toCents, toDbAmount, type MoneyValue } from "./money";

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
): Payslip {
  const inss = inssContribution(gross, table);
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

export type IncomePart = "salario" | "ferias" | "13-1" | "13-2";

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

/** O que a renda paga em um mês, sem tratar do que já foi recebido. */
export function monthIncome(
  source: IncomeSourceInput,
  tables: FiscalTable[],
  month: YearMonth,
): ScheduledEntry[] {
  if (month < source.startMonth) return [];
  if (source.endMonth !== null && month > source.endMonth) return [];

  const entry = (part: IncomePart, description: string, amount: string, date: string) => ({
    key: incomeKey(source.id, month, part),
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

  const table = fiscalTableFor(tables, month);
  const input = payrollOf(source);
  const calendarMonth = Number(month.slice(5));
  const entries =
    calendarMonth === source.vacationMonth
      ? [entry("ferias", `Férias · ${source.name}`, calculateVacation(input, table).net, payDate)]
      : [entry("salario", source.name, calculatePayslip(input, table).net, payDate)];

  if (calendarMonth === 11)
    entries.push(
      entry(
        "13-1",
        `13º, 1ª parcela · ${source.name}`,
        calculateThirteenth(input, table).firstInstallment,
        `${month}-30`,
      ),
    );
  if (calendarMonth === 12)
    entries.push(
      entry(
        "13-2",
        `13º, 2ª parcela · ${source.name}`,
        calculateThirteenth(input, table).secondInstallment,
        `${month}-20`,
      ),
    );
  // Desconto maior que o valor não vira previsão de receita negativa.
  return entries.filter((item) => money(item.amount).gt(0));
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

/** Valor de um mês normal: líquido estimado na CLT, valor informado nos outros tipos. */
export function monthlyNet(source: IncomeSourceInput, tables: FiscalTable[], month: YearMonth) {
  return isPayroll(source)
    ? calculatePayslip(payrollOf(source), fiscalTableFor(tables, month)).net
    : toDbAmount(source.amount);
}
