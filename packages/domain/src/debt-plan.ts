// Plano de saída das dívidas (ADR-0019). Compara maior juro primeiro (avalanche) e menor saldo primeiro
// (bola de neve) com o valor extra da divisão do que sobra, e diz o que muda frente a só pagar as
// parcelas. Puro e estimativa: usa a mesma simulação mês a mês de `simulatePayoff`, não muda parcela.
import { isExpensiveDebt } from "./allocation";
import { addMonths, formatYearMonth, yearMonthOf } from "./cashflow";
import {
  simulatePayoff,
  type DebtSystem,
  type PayoffDebt,
  type PayoffResult,
  type PayoffStrategy,
} from "./debt";
import { message, moneyValue, type Message } from "./messages";
import { formatMoney, money, toDbAmount, type Currency } from "./money";

/** Juro ao mês a partir do qual vale procurar portabilidade ou renegociar. Decisão no ADR-0019. */
export const HIGH_DEBT_MONTHLY_RATE = "2.50";

export interface PlanDebt extends PayoffDebt {
  system: DebtSystem;
  /** Vencimento da próxima parcela em aberto. */
  nextDue: string;
}

export interface DebtPlanInput {
  /** AAAA-MM-DD no fuso da família. */
  today: string;
  /** Valor extra por mês: `allocation.debt`. */
  extra: string;
  debts: PlanDebt[];
  /** Rendimento anual usado no plano de aposentadoria. Null se não há. */
  yieldAnnualPercent: string | null;
  /** Dias do mês em que a renda entra. */
  payDays: number[];
}

export type DebtStrategy = Exclude<PayoffStrategy, "minimum">;

export const DEBT_SIGNAL_KINDS = [
  "juro_acima_do_rendimento",
  "vence_antes_da_renda",
  "portabilidade",
  "dado_faltando",
] as const;
export type DebtSignalKind = (typeof DEBT_SIGNAL_KINDS)[number];

export interface DebtSignal {
  kind: DebtSignalKind;
  debtId: string;
  debtName: string;
  /** Sem nome de dívida e sem citar banco. */
  text: string;
}

export interface DebtPlanStrategy {
  strategy: DebtStrategy;
  months: number;
  /** Mês em que tudo termina. Null quando a parcela não cobre os juros. */
  payoffMonth: string | null;
  totalInterest: string;
  /** Juros a menos que só pagar as parcelas. */
  saved: string;
  focus: PayoffResult["focus"];
  /** Dívidas na ordem em que recebem o valor a mais, com o mês em que cada uma termina. */
  attack: Array<{ id: string; name: string; month: number | null }>;
  /** O que pagar a mais no primeiro mês. */
  thisMonth: PayoffResult["firstMonthExtra"];
  stalled: boolean;
}

export interface DebtPlan {
  /** Primeiro mês do plano. */
  month: string;
  extra: string;
  totalBalance: string;
  baseline: { months: number; payoffMonth: string | null; totalInterest: string; stalled: boolean };
  avalanche: DebtPlanStrategy;
  snowball: DebtPlanStrategy;
  recommended: DebtStrategy;
  signals: DebtSignal[];
}

const rateText = (percent: string) => money(percent).toFixed(2).replace(".", ",");
const informedRate = (debt: PlanDebt) => debt.rankRate ?? debt.monthlyRate;
const dayOf = (date: string) => Number(date.slice(8, 10));

/** Começa no mês atual, ou no da primeira parcela em aberto quando este já foi todo pago. */
function firstPlanMonth(today: string, debts: PlanDebt[]): string {
  const current = yearMonthOf(today);
  const first = debts.map((debt) => yearMonthOf(debt.nextDue)).sort()[0] ?? current;
  return first > current ? first : current;
}

function outcome(
  debts: PlanDebt[],
  input: Pick<DebtPlanInput, "extra">,
  strategy: DebtStrategy,
  baseline: PayoffResult,
  month: string,
): DebtPlanStrategy {
  const result = simulatePayoff(debts, input.extra, strategy);
  const saved = money(baseline.totalInterest).minus(result.totalInterest);
  const ranked = [...debts].sort((a, b) =>
    strategy === "avalanche"
      ? money(informedRate(b)).comparedTo(informedRate(a)) || money(a.balance).comparedTo(b.balance)
      : money(a.balance).comparedTo(b.balance),
  );
  return {
    strategy,
    months: result.months,
    payoffMonth: result.stalled ? null : addMonths(month, result.months - 1),
    totalInterest: result.totalInterest,
    saved: toDbAmount(saved.gt(0) ? saved : 0),
    focus: result.focus,
    attack: ranked.map((debt) => ({
      id: debt.id,
      name: debt.name,
      month: result.order.find((item) => item.id === debt.id)?.month ?? null,
    })),
    thisMonth: result.firstMonthExtra,
    stalled: result.stalled,
  };
}

/** A mais barata. Se empatam, a que termina antes; persistindo o empate, a de maior juro. */
function cheaper(avalanche: DebtPlanStrategy, snowball: DebtPlanStrategy): DebtStrategy {
  if (avalanche.stalled !== snowball.stalled) return avalanche.stalled ? "snowball" : "avalanche";
  const byInterest = money(snowball.totalInterest).comparedTo(avalanche.totalInterest);
  if (byInterest !== 0) return byInterest < 0 ? "snowball" : "avalanche";
  return snowball.months < avalanche.months ? "snowball" : "avalanche";
}

export function debtSignals(input: DebtPlanInput): DebtSignal[] {
  const firstPay = input.payDays.length > 0 ? Math.min(...input.payDays) : null;
  return input.debts.flatMap((debt) => {
    const rate = informedRate(debt);
    const signal = (kind: DebtSignalKind, text: string): DebtSignal => ({
      kind,
      debtId: debt.id,
      debtName: debt.name,
      text,
    });
    const found: DebtSignal[] = [];
    if (money(rate).isZero()) {
      found.push(
        signal(
          "dado_faltando",
          "Faltam os juros desta dívida. Sem eles, o plano não sabe o quanto ela custa: confira no contrato ou no boleto.",
        ),
      );
    }
    if (isExpensiveDebt(rate, input.yieldAnnualPercent)) {
      found.push(
        signal(
          "juro_acima_do_rendimento",
          `Custa ${rateText(rate)}% ao mês, mais do que o dinheiro costuma render. Quitar antes vale mais que investir.`,
        ),
      );
    }
    if (money(rate).gte(HIGH_DEBT_MONTHLY_RATE)) {
      found.push(
        signal(
          "portabilidade",
          `Com ${rateText(rate)}% ao mês, vale pedir propostas de portabilidade para outra instituição ou renegociar a taxa.`,
        ),
      );
    }
    if (firstPay !== null && dayOf(debt.nextDue) < firstPay) {
      found.push(
        signal(
          "vence_antes_da_renda",
          `A parcela vence no dia ${dayOf(debt.nextDue)}, antes de a renda entrar, no dia ${firstPay}. Vale pedir para mudar o vencimento.`,
        ),
      );
    }
    return found;
  });
}

/** Plano completo, ou null sem dívida em aberto. */
export function planDebtPayoff(input: DebtPlanInput): DebtPlan | null {
  const { debts } = input;
  if (debts.length === 0) return null;
  const month = firstPlanMonth(input.today, debts);
  const baseline = simulatePayoff(debts, "0", "minimum");
  const avalanche = outcome(debts, input, "avalanche", baseline, month);
  const snowball = outcome(debts, input, "snowball", baseline, month);
  return {
    month,
    extra: toDbAmount(input.extra),
    totalBalance: toDbAmount(debts.reduce((acc, debt) => acc.plus(debt.balance), money(0))),
    baseline: {
      months: baseline.months,
      payoffMonth: baseline.stalled ? null : addMonths(month, baseline.months - 1),
      totalInterest: baseline.totalInterest,
      stalled: baseline.stalled,
    },
    avalanche,
    snowball,
    recommended: cheaper(avalanche, snowball),
    signals: debtSignals(input),
  };
}

export const recommendedStrategy = (plan: DebtPlan) => plan[plan.recommended];

/** A frase de cima da tela e do relatório do dia. */
export function debtPlanHeadline(plan: DebtPlan, currency: Currency = "BRL"): string {
  const best = recommendedStrategy(plan);
  if (best.payoffMonth === null) return "Com o que você paga hoje, as dívidas não terminam";
  const when = `Quite tudo em ${formatYearMonth(best.payoffMonth)}`;
  return money(best.saved).isZero()
    ? when
    : `${when} e economize ${formatMoney(best.saved, currency)}`;
}

/** A mesma frase, por chave. */
export function debtPlanHeadlineMessage(plan: DebtPlan, currency: Currency = "BRL"): Message {
  const best = recommendedStrategy(plan);
  if (best.payoffMonth === null) return message("frases.relDividasNaoTerminam");
  const month = { month: best.payoffMonth };
  return money(best.saved).isZero()
    ? message("frases.relDividasQuite", { month })
    : message("frases.relDividasQuiteEconomize", {
        month,
        saved: moneyValue(best.saved, currency),
      });
}
