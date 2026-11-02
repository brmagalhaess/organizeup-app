// Plano mensal das metas (ADR-0016). Puro e estimativa: dado o orçamento que sobra para metas,
// distribui parcelas por prioridade e prazo. O que a família informou (valor, data, prioridade) só
// muda por sugestão aceita; o plano (início, fim, parcela) é dado derivado, recalculado todo dia.
import { addMonths, formatYearMonth, yearMonthOf, type YearMonth } from "./cashflow";
import { message, moneyValue, type Message } from "./messages";
import { formatMoney, money, toCents, toDbAmount, type Currency, type MoneyValue } from "./money";
import { monthsBetween } from "./trip";
import Decimal from "decimal.js";

export const GOAL_RULES = {
  /** Plano mais longo que isto não vale a pena mostrar. */
  maxMonths: 120,
  /** Parcela menor que este % do que falta não vale a pena mostrar. */
  minMonthlyPercent: 1,
} as const;

export type GoalStatus = "planejando" | "juntando" | "concluida" | "pausada";

export interface GoalInput {
  id: string;
  /** Só para as notas ("começa quando X terminar"). */
  name?: string;
  targetAmount: string;
  saved: string;
  desiredMonth: YearMonth | null;
  /** 1 (mais urgente) a 5. */
  priority: number;
  status: GoalStatus;
  /** Meses com parcela já confirmada: não recebem parcela nova. */
  confirmedMonths: YearMonth[];
  /** Sobrepõe o `planDayPassed` geral quando o dia desta meta já passou. */
  planDayPassed?: boolean;
}

export interface GoalContribution {
  month: YearMonth;
  amount: string;
}

export interface GoalPlan {
  id: string;
  /** Status recalculado: `concluida` quando o guardado alcança o alvo. */
  status: GoalStatus;
  start: YearMonth | null;
  end: YearMonth | null;
  /** Parcela mensal. Null sem plano. */
  monthly: string | null;
  /** Quantidade de parcelas. */
  months: number;
  /** Null sem data desejada. */
  onTime: boolean | null;
  note: string;
  /** A mesma nota, por chave, para sair no idioma de quem lê. */
  noteMessages: Message[];
  contributions: GoalContribution[];
}

export interface PlanGoalsInput {
  today: string;
  /** O dia de guardar deste mês já passou: a primeira parcela vai para o mês seguinte. */
  planDayPassed: boolean;
  /** `allocation.goalsBudget`. */
  budget: string;
  goals: GoalInput[];
  /** Moeda principal da família, para as notas. Sem ela, real. */
  currency?: Currency;
}

interface Release {
  name: string;
  end: YearMonth;
  monthly: MoneyValue;
}

const later = (a: YearMonth, b: YearMonth) => (a > b ? a : b);

function installments(
  start: YearMonth,
  count: number,
  monthly: MoneyValue,
  missing: MoneyValue,
  confirmed: Set<YearMonth>,
): GoalContribution[] {
  const out: GoalContribution[] = [];
  let month = start;
  while (out.length < count) {
    if (!confirmed.has(month)) {
      const last = out.length === count - 1;
      const amount = last ? missing.minus(monthly.times(count - 1)) : monthly;
      out.push({ month, amount: toDbAmount(amount) });
    }
    month = addMonths(month, 1);
  }
  return out;
}

interface Core {
  monthly: MoneyValue;
  count: number;
  contributions: GoalContribution[];
  end: YearMonth;
  onTime: boolean | null;
  note: string;
  noteMessages: Message[];
}

function planOne(
  start: YearMonth,
  cap: MoneyValue,
  missing: MoneyValue,
  desiredMonth: YearMonth | null,
  confirmed: Set<YearMonth>,
  currency: Currency | undefined,
): Core | { note: string; noteMessages: Message[] } {
  // Ninguém guarda mais do que falta: a parcela é no máximo o que falta.
  let monthly = cap.gt(missing) ? missing : cap;
  let onTime: boolean | null = null;
  let note = "";
  let noteMessages: Message[] = [];
  if (desiredMonth !== null && desiredMonth >= start) {
    const available = monthsBetween(start, desiredMonth) + 1;
    const needed = missing.dividedBy(available).toDecimalPlaces(2, Decimal.ROUND_UP);
    if (needed.lte(cap)) {
      monthly = needed;
      onTime = true;
    } else {
      onTime = false;
    }
  } else if (desiredMonth !== null) {
    onTime = false;
  }
  if (monthly.lte(0)) return { note: "", noteMessages: [] };
  const count = missing.dividedBy(monthly).ceil().toNumber();
  if (
    count > GOAL_RULES.maxMonths ||
    monthly.lt(missing.times(GOAL_RULES.minMonthlyPercent).dividedBy(100))
  ) {
    return {
      note: `Com ${formatMoney(monthly, currency)} por mês levaria mais de 10 anos; reduza o valor, adie a data ou aumente o que guarda.`,
      noteMessages: [
        message("frases.notaLonga", { amount: moneyValue(toDbAmount(monthly), currency) }),
      ],
    };
  }
  const contributions = installments(start, count, monthly, missing, confirmed);
  const end = contributions[contributions.length - 1]!.month;
  if (desiredMonth !== null) {
    onTime = end <= desiredMonth;
    if (desiredMonth < start) {
      note = `A data desejada já passou; nova previsão: ${formatYearMonth(end)}.`;
      noteMessages = [message("frases.notaDataPassou", { end: { month: end } })];
    } else if (!onTime) {
      note = `Não cabe no orçamento até ${formatYearMonth(desiredMonth)}; termina em ${formatYearMonth(end)}.`;
      noteMessages = [
        message("frases.notaNaoCabe", { desired: { month: desiredMonth }, end: { month: end } }),
      ];
    }
  }
  return { monthly, count, contributions, end, onTime, note, noteMessages };
}

/**
 * Distribui o orçamento de metas por prioridade (e prazo mais próximo). Cada meta recebe uma
 * parcela mensal; quando o orçamento acaba, a próxima começa quando uma anterior terminar.
 */
export function planGoals(input: PlanGoalsInput): GoalPlan[] {
  const currentMonth = yearMonthOf(input.today);
  const ordered = [...input.goals].sort(
    (a, b) =>
      a.priority - b.priority ||
      (a.desiredMonth ?? "9999-99").localeCompare(b.desiredMonth ?? "9999-99") ||
      a.id.localeCompare(b.id),
  );
  let budgetLeft = toCents(input.budget).gt(0) ? toCents(input.budget) : money(0);
  const releases: Release[] = [];
  const plans: GoalPlan[] = [];

  for (const goal of ordered) {
    const noPlan = (status: GoalStatus, note: string, noteMessages: Message[]): GoalPlan => ({
      id: goal.id,
      status,
      start: null,
      end: null,
      monthly: null,
      months: 0,
      onTime: null,
      note,
      noteMessages,
      contributions: [],
    });
    const missing = money(goal.targetAmount).minus(goal.saved);
    if (missing.lte(0)) {
      plans.push(noPlan("concluida", "Meta conquistada.", [message("frases.notaConquistada")]));
      continue;
    }
    if (goal.status === "pausada") {
      plans.push(
        noPlan("pausada", "Meta pausada: sem parcelas até retomar.", [
          message("frases.notaPausada"),
        ]),
      );
      continue;
    }

    const confirmed = new Set(goal.confirmedMonths);
    const dayPassed = goal.planDayPassed ?? input.planDayPassed;
    let firstMonth = dayPassed ? addMonths(currentMonth, 1) : currentMonth;
    for (const month of confirmed) firstMonth = later(firstMonth, addMonths(month, 1));

    let start = firstMonth;
    let cap = budgetLeft;
    let release: Release | null = null;
    if (cap.lte(0)) {
      const sorted = [...releases].sort((a, b) => a.end.localeCompare(b.end));
      release = sorted[0] ?? null;
      if (!release) {
        plans.push(
          noPlan(
            goal.status,
            "Hoje não sobra orçamento para esta meta. Reduza o valor, adie a data ou pause outra meta.",
            [message("frases.notaSemOrcamentoReduza")],
          ),
        );
        continue;
      }
      releases.splice(releases.indexOf(release), 1);
      start = later(firstMonth, addMonths(release.end, 1));
      cap = release.monthly;
    }

    const core = planOne(start, cap, missing, goal.desiredMonth, confirmed, input.currency);
    if (!("monthly" in core)) {
      if (release) releases.push(release);
      plans.push(
        core.note
          ? noPlan(goal.status, core.note, core.noteMessages)
          : noPlan(goal.status, "Hoje não sobra orçamento para esta meta.", [
              message("frases.notaSemOrcamento"),
            ]),
      );
      continue;
    }

    if (release) {
      core.note = `Começa quando ${release.name} terminar.${core.note ? ` ${core.note}` : ""}`;
      core.noteMessages = [
        message("frases.notaComeca", { name: release.name }),
        ...core.noteMessages,
      ];
    } else {
      budgetLeft = budgetLeft.minus(core.monthly);
    }
    releases.push({ name: goal.name ?? "outra meta", end: core.end, monthly: core.monthly });
    plans.push({
      id: goal.id,
      status: "juntando",
      start: core.contributions[0]!.month,
      end: core.end,
      monthly: toDbAmount(core.monthly),
      months: core.count,
      onTime: core.onTime,
      note: core.note,
      noteMessages: core.noteMessages,
      contributions: core.contributions,
    });
  }
  return plans;
}
