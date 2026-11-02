// Projeção de aposentadoria. Puro. Tudo em dinheiro de hoje, com retorno real (acima da inflação),
// para o número fazer sentido sem adivinhar a inflação de décadas. É estimativa, não promessa.
import { money, toDbAmount, type MoneyInput, type MoneyValue } from "./money";

export interface RetirementInput {
  /** Idade hoje, em meses. */
  ageMonths: number;
  targetAge: number;
  lifeExpectancy: number;
  /** Renda mensal desejada. */
  targetIncome: string;
  /** INSS e outras rendas que continuam, por mês. */
  otherIncome: string;
  saved: string;
  monthlyContribution: string;
  /** % ao ano acima da inflação, antes e depois de parar. */
  returnBefore: string;
  returnAfter: string;
}

export interface RetirementResult {
  monthsToRetire: number;
  /** O que falta tirar do patrimônio por mês. */
  incomeGap: string;
  /** Patrimônio necessário no dia de parar. */
  needed: string;
  /** Patrimônio projetado no dia de parar. */
  projected: string;
  /** 0 a 100 do necessário. */
  percent: number;
  /** Aporte mensal total que fecha a conta. Null se já parou e não fecha. */
  requiredContribution: string | null;
  /** Renda mensal que o plano atual sustenta, somando as outras rendas. */
  sustainableIncome: string;
  /** Idade em que o dinheiro acaba. Null se dura até a expectativa de vida. */
  runsOutAtAge: number | null;
  /** Uma posição por ano de idade. */
  series: Array<{ age: number; value: string }>;
}

/** Taxa mensal equivalente a uma taxa anual em % ("6" = 6% a.a. → 0,4868% a.m.), como fração. */
export const monthlyRate = (annualPercent: MoneyInput): MoneyValue =>
  money(1).plus(money(annualPercent).dividedBy(100)).pow(money(1).dividedBy(12)).minus(1);

/** Quanto R$ 1 por mês acumula em `months` meses, à taxa mensal `rate` (fração). */
export function accumulationFactor(rate: MoneyValue, months: number): MoneyValue {
  if (rate.isZero()) return money(months);
  return rate.plus(1).pow(months).minus(1).dividedBy(rate);
}

/** Valor hoje de R$ 1 por mês durante `months` meses, à taxa mensal `rate` (fração). */
export function annuityFactor(rate: MoneyValue, months: number): MoneyValue {
  if (rate.isZero()) return money(months);
  return money(1).minus(rate.plus(1).pow(-months)).dividedBy(rate);
}

export function projectRetirement(input: RetirementInput): RetirementResult {
  const before = monthlyRate(input.returnBefore);
  const after = monthlyRate(input.returnAfter);
  const monthsToRetire = Math.max(0, input.targetAge * 12 - input.ageMonths);
  const start = Math.max(input.ageMonths, input.targetAge * 12);
  const monthsRetired = Math.max(1, input.lifeExpectancy * 12 - start);

  const gap = money(input.targetIncome).minus(input.otherIncome);
  const incomeGap = gap.gt(0) ? gap : money(0);
  const needed = incomeGap.times(annuityFactor(after, monthsRetired));
  const growth = before.plus(1).pow(monthsToRetire);
  const factor = accumulationFactor(before, monthsToRetire);
  const projected = money(input.saved)
    .times(growth)
    .plus(money(input.monthlyContribution).times(factor));

  const missing = needed.minus(money(input.saved).times(growth));
  const requiredContribution =
    monthsToRetire === 0
      ? missing.gt(0)
        ? null
        : "0.00"
      : toDbAmount(missing.gt(0) ? missing.dividedBy(factor) : 0);

  const sustainable = projected
    .dividedBy(annuityFactor(after, monthsRetired))
    .plus(input.otherIncome);

  // Simulação mês a mês: alimenta o gráfico e diz quando o dinheiro acaba.
  const series: RetirementResult["series"] = [];
  let balance = money(input.saved);
  let runsOutAtAge: number | null = null;
  const firstAge = Math.floor(input.ageMonths / 12);
  for (let month = input.ageMonths; month <= input.lifeExpectancy * 12; month += 1) {
    if (month % 12 === 0 || month === input.ageMonths) {
      const age = Math.floor(month / 12);
      if (age === firstAge || month % 12 === 0)
        series.push({ age, value: toDbAmount(balance.gt(0) ? balance : 0) });
    }
    if (month < input.targetAge * 12) {
      balance = balance.times(before.plus(1)).plus(input.monthlyContribution);
    } else {
      balance = balance.times(after.plus(1)).minus(incomeGap);
      if (balance.lt(0)) {
        balance = money(0);
        if (runsOutAtAge === null && incomeGap.gt(0)) runsOutAtAge = Math.floor(month / 12);
      }
    }
  }

  return {
    monthsToRetire,
    incomeGap: toDbAmount(incomeGap),
    needed: toDbAmount(needed),
    projected: toDbAmount(projected),
    percent: needed.isZero()
      ? 100
      : Math.min(100, projected.dividedBy(needed).times(100).toDecimalPlaces(0).toNumber()),
    requiredContribution,
    sustainableIncome: toDbAmount(sustainable),
    runsOutAtAge,
    series,
  };
}
