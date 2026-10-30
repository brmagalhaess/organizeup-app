// Regras de dívidas: calendário de parcelas e ordem de quitação.
import { addMonths, occurrenceDate, yearMonthOf } from "./cashflow";
import { money, toCents, toDbAmount, type MoneyValue } from "./money";

/** Categoria das parcelas pagas. */
export const DEBT_CATEGORY = "Dívidas e empréstimos";

export const DEBT_SYSTEMS = ["price", "sac", "manual"] as const;
export type DebtSystem = (typeof DEBT_SYSTEMS)[number];

export interface DebtTerms {
  system: DebtSystem;
  /** Saldo devedor de hoje. Ignorado em `manual`, onde o saldo é parcela × quantidade. */
  balance: string;
  /** Juros ao mês em %, como "2.15". */
  monthlyRate: string;
  installments: number;
  firstDueDate: string;
  /** Valor da parcela, usado só em `manual`. */
  installmentAmount?: string;
}

export interface ScheduleRow {
  number: number;
  dueDate: string;
  amount: string;
  principal: string;
  interest: string;
}

const rateOf = (percent: string) => money(percent).dividedBy(100);

/**
 * Prestação fixa pela fórmula de prestações iguais (Tabela Price), a mesma da
 * Calculadora do Cidadão do Banco Central: PMT = PV × i / (1 − (1 + i)^−n).
 */
export function priceInstallment(balance: string, monthlyRate: string, count: number): string {
  const rate = rateOf(monthlyRate);
  if (rate.isZero()) return toDbAmount(money(balance).dividedBy(count));
  const factor = money(1).minus(rate.plus(1).pow(-count));
  return toDbAmount(money(balance).times(rate).dividedBy(factor));
}

/**
 * Calendário das parcelas restantes. Juros e amortização são arredondados a cada parcela
 * e a última absorve o resíduo, para o saldo terminar exatamente em zero (ADR-0004).
 */
export function buildSchedule(terms: DebtTerms): ScheduleRow[] {
  const { system, installments: count, firstDueDate } = terms;
  const day = Number(firstDueDate.slice(8, 10));
  const firstMonth = yearMonthOf(firstDueDate);
  const dueDate = (index: number) => occurrenceDate(day, addMonths(firstMonth, index));

  if (system === "manual") {
    const amount = toDbAmount(terms.installmentAmount ?? "0");
    return Array.from({ length: count }, (_, index) => ({
      number: index + 1,
      dueDate: dueDate(index),
      amount,
      principal: amount,
      interest: "0.00",
    }));
  }

  const rate = rateOf(terms.monthlyRate);
  const payment = money(priceInstallment(terms.balance, terms.monthlyRate, count));
  const steadyPrincipal = toCents(money(terms.balance).dividedBy(count));
  let balance: MoneyValue = toCents(terms.balance);

  return Array.from({ length: count }, (_, index) => {
    const interest = toCents(balance.times(rate));
    const last = index === count - 1;
    const principal = last
      ? balance
      : system === "price"
        ? payment.minus(interest)
        : steadyPrincipal;
    balance = balance.minus(principal);
    return {
      number: index + 1,
      dueDate: dueDate(index),
      amount: toDbAmount(principal.plus(interest)),
      principal: toDbAmount(principal),
      interest: toDbAmount(interest),
    };
  });
}

export const PAYOFF_STRATEGIES = ["avalanche", "snowball", "minimum"] as const;
export type PayoffStrategy = (typeof PAYOFF_STRATEGIES)[number];

export interface PayoffDebt {
  id: string;
  name: string;
  balance: string;
  monthlyRate: string;
  /** Parcela paga todo mês. */
  minimum: string;
  /** Juros usados só para ordenar, quando eles já estão embutidos no saldo. */
  rankRate?: string;
}

export interface PayoffResult {
  strategy: PayoffStrategy;
  months: number;
  totalInterest: string;
  /** Dívida que recebe o valor a mais primeiro. Pode não ser a primeira a terminar. */
  focus: { id: string; name: string } | null;
  order: Array<{ id: string; name: string; month: number }>;
  /** A parcela não cobre os juros: a dívida nunca termina. */
  stalled: boolean;
}

const MAX_MONTHS = 600;

/**
 * Estimativa mês a mês. `avalanche` ataca os maiores juros e `snowball` o menor saldo;
 * nos dois, a parcela de quem terminou reforça a próxima. `minimum` só paga as parcelas.
 */
export function simulatePayoff(
  debts: PayoffDebt[],
  extra: string,
  strategy: PayoffStrategy,
): PayoffResult {
  const open = debts.map((debt) => ({
    ...debt,
    left: money(debt.balance),
    rate: rateOf(debt.monthlyRate),
    rank: money(debt.rankRate ?? debt.monthlyRate),
    due: money(debt.minimum),
  }));
  const committed = open.reduce((acc, debt) => acc.plus(debt.due), money(0));
  const order: PayoffResult["order"] = [];
  let focus: PayoffResult["focus"] = null;
  let totalInterest = money(0);
  let month = 0;

  while (open.some((debt) => debt.left.gt(0)) && month < MAX_MONTHS) {
    month += 1;
    let budget = strategy === "minimum" ? money(0) : committed.plus(extra);
    const active = open.filter((debt) => debt.left.gt(0));

    for (const debt of active) {
      const interest = toCents(debt.left.times(debt.rate));
      totalInterest = totalInterest.plus(interest);
      debt.left = debt.left.plus(interest);
      const paid = debt.left.lt(debt.due) ? debt.left : debt.due;
      debt.left = debt.left.minus(paid);
      if (strategy !== "minimum") budget = budget.minus(paid);
    }

    const targets = active
      .filter((debt) => debt.left.gt(0))
      .sort((a, b) =>
        strategy === "avalanche"
          ? b.rank.comparedTo(a.rank) || a.left.comparedTo(b.left)
          : a.left.comparedTo(b.left),
      );
    if (month === 1 && targets[0] && strategy !== "minimum")
      focus = { id: targets[0].id, name: targets[0].name };
    for (const debt of targets) {
      if (budget.lte(0)) break;
      const paid = debt.left.lt(budget) ? debt.left : budget;
      debt.left = debt.left.minus(paid);
      budget = budget.minus(paid);
    }

    for (const debt of active) {
      if (debt.left.lte(0)) order.push({ id: debt.id, name: debt.name, month });
    }
  }

  return {
    strategy,
    months: month,
    totalInterest: toDbAmount(totalInterest),
    focus,
    order,
    stalled: open.some((debt) => debt.left.gt(0)),
  };
}
