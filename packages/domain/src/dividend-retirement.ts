// Aposentadoria por renda de proventos (ADR-0015, substitui em parte o ADR-0014). Puro e estimativa:
// a carteira paga as contas e não acaba. Premissas: tudo em reais de hoje; proventos líquidos do
// imposto retido; proventos reinvestidos ao mesmo rendimento; o preço acompanha os proventos, então o
// rendimento (yield) fica constante; retorno real anual = (1 + y)(1 + g) − 1, com g o crescimento real
// dos proventos; não prevê mudança de tributação. Proventos passados não garantem proventos futuros e
// nada aqui é recomendação de investimento.
import Decimal from "decimal.js";
import { addMonths, recentMonths, yearMonthOf, type YearMonth } from "./cashflow";
import { netDividend, type DividendInput } from "./investment";
import { formatBRL, money, toCents, toDbAmount, type MoneyValue } from "./money";
import { accumulationFactor, monthlyRate } from "./retirement";
import { monthsBetween } from "./trip";

export const DIVIDEND_RULES = {
  /** Renda alvo derivada: o maior entre gasto essencial × 1,2 e o gasto médio de 12 meses. */
  essentialFactor: 1.2,
  /** Rendimento observado fora desta faixa (% a.a.) é suspeito. */
  minYield: "1",
  maxYield: "20",
  /** Ativo com menos meses que isto fica fora da base do rendimento observado. */
  minMonthsHeld: 3,
  /** Projeção vai até aqui; depois disso "não fecha". */
  horizonYears: 60,
  /** Classes que pagam renda. */
  payerClasses: ["acao", "fii", "etf_bdr", "exterior"],
} as const;

export interface PensionInput {
  /** Benefício mensal esperado (INSS ou outro). */
  amount: string;
  /** Idade da pessoa no ano alvo. Null sem nascimento: conta como se já entrasse. */
  ageAtTarget: number | null;
  retirementAge: number;
}

export interface DividendAssetInput {
  id: string;
  assetClass: string;
  value: string;
  /** Proventos líquidos dos últimos 12 meses. */
  dividendsNet12: string;
  monthsHeld: number;
  /** Primeiro provento recebido. Reservado para a tela; não muda a conta. */
  firstDividendOn: string | null;
}

export interface DividendPlanInput {
  today: string;
  /** Ano em que a família quer parar. Null = sem ano. */
  targetYear: number | null;
  /** Renda mensal desejada. Null = derivar do gasto. */
  targetIncome: string | null;
  essentialMonthly: string;
  averageExpenses12: string | null;
  pensions: PensionInput[];
  assets: DividendAssetInput[];
  /** Rendimento anual informado (% a.a.). Null = usar o observado. */
  expectedYield: string | null;
  /** Crescimento real anual dos proventos (% a.a.). */
  dividendGrowth: string;
  /** Aporte mensal real, para projetar. */
  contribution: string;
}

export type DividendPlanStatus = "ok" | "sem_dados" | "sem_yield" | "sem_ano";
export type TargetIncomeBasis = "informado" | "gasto_medio" | "essencial_120" | "sem_dados";
export type YieldBasis =
  "observado_12m" | "observado_anualizado" | "informado" | "sem_dados" | "suspeito";

export interface DividendPlan {
  status: DividendPlanStatus;
  /** Renda alvo usada. Null quando não há dado. */
  targetIncome: string | null;
  targetBasis: TargetIncomeBasis;
  /** Pensões que já entram no ano alvo. */
  otherIncome: string;
  /** Pensões que entram depois do ano alvo. */
  pensionsLater: Array<{ amount: string; fromYear: number }>;
  /** O que a carteira precisa pagar por mês. */
  incomeGap: string;
  /** Renda atual em proventos (média mensal dos últimos 12 meses). */
  currentIncome: string;
  /** 0 a 999: quanto da renda que falta a carteira já paga. 100 quando não falta nada. */
  coverage: number;
  /** Rendimento anual usado (% a.a.). */
  yieldUsed: string | null;
  yieldBasis: YieldBasis;
  /** Rendimento observado (% a.a.), mesmo quando suspeito. */
  observedYield: string | null;
  /** Menor histórico entre os ativos da base, quando algum tem menos de 12 meses. */
  yieldMonthsBasis: number | null;
  suspiciousAssets: string[];
  /** Valor dos ativos que pagam renda. */
  incomeBase: string;
  /** Valor dos demais investimentos (premissa: migram para ativos pagadores). */
  otherBase: string;
  /** Carteira que paga a renda que falta. Null sem rendimento. */
  requiredPortfolio: string | null;
  /** Quanto falta para a carteira necessária. Null sem rendimento. */
  portfolioGap: string | null;
  /** Meses até janeiro do ano alvo; 0 se já passou; null sem ano. */
  monthsToTarget: number | null;
  /** Aporte mensal que fecha a carteira no ano alvo. Null sem ano/rendimento ou se já passou sem fechar. */
  requiredContribution: string | null;
  /** Primeiro ano em que a carteira fecha com o aporte real. Null se não fecha em 60 anos. */
  yearWithContribution: number | null;
  /** Renda mensal em proventos projetada para o ano alvo, com o aporte real. */
  projectedIncomeAtTarget: string | null;
  /** Uma posição por ano: carteira e renda mensal que ela paga. */
  series: Array<{ year: number; value: string; income: string }>;
  notes: string[];
}

const sumOf = (values: MoneyValue[]) => values.reduce((acc, value) => acc.plus(value), money(0));
const percent = (value: MoneyValue) => value.times(100).toDecimalPlaces(2).toString();

function targetIncomeOf(input: DividendPlanInput): { value: MoneyValue; basis: TargetIncomeBasis } {
  if (input.targetIncome !== null && money(input.targetIncome).gt(0)) {
    return { value: money(input.targetIncome), basis: "informado" };
  }
  const essential = money(input.essentialMonthly).times(DIVIDEND_RULES.essentialFactor);
  const average = input.averageExpenses12 === null ? money(0) : money(input.averageExpenses12);
  if (average.gt(essential) && average.gt(0)) return { value: average, basis: "gasto_medio" };
  if (essential.gt(0)) return { value: essential, basis: "essencial_120" };
  return { value: money(0), basis: "sem_dados" };
}

interface YieldEstimate {
  used: MoneyValue | null;
  basis: YieldBasis;
  observed: MoneyValue | null;
  monthsBasis: number | null;
  suspicious: string[];
}

function yieldOf(payers: DividendAssetInput[], expected: string | null): YieldEstimate {
  const informed = expected !== null && money(expected).gt(0) ? money(expected) : null;
  const base = payers.filter(
    (asset) => asset.monthsHeld >= DIVIDEND_RULES.minMonthsHeld && money(asset.value).gt(0),
  );
  if (base.length === 0) {
    return {
      used: informed,
      basis: informed ? "informado" : "sem_dados",
      observed: null,
      monthsBasis: null,
      suspicious: [],
    };
  }
  const annualized = (asset: DividendAssetInput) =>
    asset.monthsHeld >= 12
      ? money(asset.dividendsNet12)
      : money(asset.dividendsNet12).times(12).dividedBy(asset.monthsHeld);
  const observed = sumOf(base.map(annualized)).dividedBy(sumOf(base.map((a) => money(a.value))));
  const inRange = (rate: MoneyValue) =>
    rate.times(100).gte(DIVIDEND_RULES.minYield) && rate.times(100).lte(DIVIDEND_RULES.maxYield);
  const months = Math.min(...base.map((asset) => asset.monthsHeld));
  if (inRange(observed)) {
    return {
      used: observed.times(100),
      basis: months >= 12 ? "observado_12m" : "observado_anualizado",
      observed: observed.times(100),
      monthsBasis: months >= 12 ? null : months,
      suspicious: [],
    };
  }
  const outliers = base
    .filter((asset) => !inRange(annualized(asset).dividedBy(asset.value)))
    .map((asset) => asset.id);
  return {
    used: informed,
    basis: "suspeito",
    observed: observed.times(100),
    monthsBasis: months >= 12 ? null : months,
    suspicious: outliers.length > 0 ? outliers : base.map((asset) => asset.id),
  };
}

export function planDividendRetirement(input: DividendPlanInput): DividendPlan {
  const notes: string[] = [];
  const currentMonth = yearMonthOf(input.today);
  const currentYear = Number(input.today.slice(0, 4));
  const target = targetIncomeOf(input);

  const empty: DividendPlan = {
    status: "sem_dados",
    targetIncome: null,
    targetBasis: "sem_dados",
    otherIncome: "0.00",
    pensionsLater: [],
    incomeGap: "0.00",
    currentIncome: "0.00",
    coverage: 0,
    yieldUsed: null,
    yieldBasis: "sem_dados",
    observedYield: null,
    yieldMonthsBasis: null,
    suspiciousAssets: [],
    incomeBase: "0.00",
    otherBase: "0.00",
    requiredPortfolio: null,
    portfolioGap: null,
    monthsToTarget: null,
    requiredContribution: null,
    yearWithContribution: null,
    projectedIncomeAtTarget: null,
    series: [],
    notes: ["Informe a renda que quer por mês ou registre seus gastos para estimar o plano."],
  };
  if (target.basis === "sem_dados") return empty;

  // Pensões: as que já valem no ano alvo abatem a renda; as demais entram depois.
  const pensionsLater: DividendPlan["pensionsLater"] = [];
  let otherIncome = money(0);
  for (const pension of input.pensions) {
    const later =
      input.targetYear !== null &&
      pension.ageAtTarget !== null &&
      pension.ageAtTarget < pension.retirementAge;
    if (later) {
      const fromYear = input.targetYear! + (pension.retirementAge - pension.ageAtTarget!);
      pensionsLater.push({ amount: toDbAmount(pension.amount), fromYear });
      notes.push(`${formatBRL(pension.amount)} de INSS ou pensão entra só em ${fromYear}.`);
    } else {
      otherIncome = otherIncome.plus(pension.amount);
    }
  }

  const gap = target.value.minus(otherIncome);
  const incomeGap = gap.gt(0) ? gap : money(0);
  const currentIncome = sumOf(input.assets.map((asset) => money(asset.dividendsNet12))).dividedBy(
    12,
  );
  const coverage = incomeGap.isZero()
    ? 100
    : Math.min(999, currentIncome.dividedBy(incomeGap).times(100).toDecimalPlaces(0).toNumber());

  const isPayer = (asset: DividendAssetInput) =>
    money(asset.dividendsNet12).gt(0) &&
    (DIVIDEND_RULES.payerClasses as readonly string[]).includes(asset.assetClass);
  const payers = input.assets.filter(isPayer);
  const incomeBase = sumOf(payers.map((asset) => money(asset.value)));
  const otherBase = sumOf(input.assets.filter((a) => !isPayer(a)).map((a) => money(a.value)));
  const total = incomeBase.plus(otherBase);

  const estimate = yieldOf(payers, input.expectedYield);
  if (estimate.basis === "observado_anualizado" && estimate.monthsBasis !== null) {
    notes.push(`Rendimento baseado em ${estimate.monthsBasis} meses de proventos.`);
  }
  if (estimate.basis === "suspeito") {
    notes.push(
      estimate.used
        ? "Rendimento observado fora do esperado; usando o informado."
        : "Rendimento observado fora do esperado; informe o rendimento anual da carteira.",
    );
  }

  const base: DividendPlan = {
    ...empty,
    status: "sem_yield",
    targetIncome: toDbAmount(target.value),
    targetBasis: target.basis,
    otherIncome: toDbAmount(otherIncome),
    pensionsLater,
    incomeGap: toDbAmount(incomeGap),
    currentIncome: toDbAmount(currentIncome),
    coverage,
    yieldUsed: estimate.used ? percent(estimate.used.dividedBy(100)) : null,
    yieldBasis: estimate.basis,
    observedYield: estimate.observed ? percent(estimate.observed.dividedBy(100)) : null,
    yieldMonthsBasis: estimate.monthsBasis,
    suspiciousAssets: estimate.suspicious,
    incomeBase: toDbAmount(incomeBase),
    otherBase: toDbAmount(otherBase),
    monthsToTarget:
      input.targetYear === null ? null : monthsBetween(currentMonth, `${input.targetYear}-01`),
    notes,
  };
  if (estimate.used === null) return base;

  const yieldUsed = estimate.used;
  const requiredPortfolio = incomeGap.times(12).dividedBy(yieldUsed.dividedBy(100));
  const portfolioGap = requiredPortfolio.minus(total).gt(0)
    ? requiredPortfolio.minus(total)
    : money(0);
  if (otherBase.gt(0) && portfolioGap.gt(0)) {
    notes.push(
      `Premissa: os outros investimentos (${formatBRL(otherBase)}) migram para ativos que pagam renda.`,
    );
  }

  // Retorno real mensal com proventos reinvestidos e crescendo `g` ao ano.
  const realAnnual = money(1)
    .plus(yieldUsed.dividedBy(100))
    .times(money(1).plus(money(input.dividendGrowth).dividedBy(100)))
    .minus(1)
    .times(100);
  const rate = monthlyRate(realAnnual);
  const monthsToTarget = base.monthsToTarget;

  let requiredContribution: string | null = null;
  if (portfolioGap.isZero()) requiredContribution = "0.00";
  else if (monthsToTarget !== null && monthsToTarget > 0) {
    const futureGap = requiredPortfolio.minus(total.times(rate.plus(1).pow(monthsToTarget)));
    requiredContribution = futureGap.gt(0)
      ? toDbAmount(
          futureGap
            .dividedBy(accumulationFactor(rate, monthsToTarget))
            .toDecimalPlaces(2, Decimal.ROUND_UP),
        )
      : "0.00";
  }

  // Projeção mês a mês com o aporte real; uma posição por ano para o gráfico.
  const contribution = money(input.contribution).gt(0) ? money(input.contribution) : money(0);
  const horizon = DIVIDEND_RULES.horizonYears * 12;
  const incomeOf = (value: MoneyValue) => value.times(yieldUsed).dividedBy(100).dividedBy(12);
  const byYear = new Map<number, MoneyValue>([[currentYear, total]]);
  let yearWithContribution: number | null = total.gte(requiredPortfolio) ? currentYear : null;
  let value = total;
  let valueAtTarget: MoneyValue | null = monthsToTarget === 0 ? total : null;
  for (let step = 1; step <= horizon; step += 1) {
    value = value.times(rate.plus(1)).plus(contribution);
    const month = addMonths(currentMonth, step);
    if (step === monthsToTarget) valueAtTarget = value;
    if (month.endsWith("-01")) {
      const year = Number(month.slice(0, 4));
      byYear.set(year, value);
      if (yearWithContribution === null && value.gte(requiredPortfolio))
        yearWithContribution = year;
    }
  }

  const lastYear = Math.min(
    currentYear + DIVIDEND_RULES.horizonYears,
    input.targetYear !== null
      ? Math.max(input.targetYear, yearWithContribution ?? input.targetYear)
      : (yearWithContribution ?? currentYear + 30),
  );
  const series: DividendPlan["series"] = [];
  for (let year = currentYear; year <= lastYear; year += 1) {
    const point = byYear.get(year);
    if (point) series.push({ year, value: toDbAmount(point), income: toDbAmount(incomeOf(point)) });
  }

  if (
    input.targetYear !== null &&
    yearWithContribution !== null &&
    yearWithContribution > input.targetYear
  ) {
    notes.push(`Com o que você guarda hoje a carteira fecha em ${yearWithContribution}.`);
  }

  return {
    ...base,
    status: input.targetYear === null ? "sem_ano" : "ok",
    requiredPortfolio: toDbAmount(requiredPortfolio),
    portfolioGap: toDbAmount(portfolioGap),
    requiredContribution,
    yearWithContribution,
    projectedIncomeAtTarget: valueAtTarget === null ? null : toDbAmount(incomeOf(valueAtTarget)),
    series,
    notes,
  };
}

export interface DividendForecast {
  investmentId: string;
  month: YearMonth;
  amount: string;
  basis: "mensal_12m" | "mesmo_mes_ano_passado";
}

/**
 * Proventos previstos pelo histórico. Ativo que pagou em 9 ou mais dos últimos 12 meses recebe a
 * média líquida mensal em todo mês; senão repete o líquido do mesmo mês do ano anterior. Sem
 * histórico, nada. Previsão, não garantia.
 */
export function forecastDividends(
  rows: DividendInput[],
  from: YearMonth,
  months = 12,
): DividendForecast[] {
  const history = recentMonths(addMonths(from, -1), 12);
  const future = Array.from({ length: months }, (_, index) => addMonths(from, index));
  const ids = [...new Set(rows.map((row) => row.investmentId))].sort();
  const out: DividendForecast[] = [];
  for (const investmentId of ids) {
    const own = rows.filter((row) => row.investmentId === investmentId);
    const recent = own.filter((row) => history.includes(yearMonthOf(row.paidOn)));
    const paidMonths = new Set(recent.map((row) => yearMonthOf(row.paidOn)));
    if (paidMonths.size >= 9) {
      const average = toDbAmount(sumOf(recent.map((row) => money(netDividend(row)))).dividedBy(12));
      for (const month of future)
        out.push({ investmentId, month, amount: average, basis: "mensal_12m" });
      continue;
    }
    for (const month of future) {
      const lastYear = addMonths(month, -12);
      const net = sumOf(
        own
          .filter((row) => yearMonthOf(row.paidOn) === lastYear)
          .map((row) => money(netDividend(row))),
      );
      if (net.gt(0)) {
        out.push({
          investmentId,
          month,
          amount: toDbAmount(toCents(net)),
          basis: "mesmo_mes_ano_passado",
        });
      }
    }
  }
  return out;
}
