// Plano do mês: as ações que mais aproximam a família da aposentadoria, com o efeito calculado pelo
// próprio plano por proventos. Puro: quem chama traz o plano, a divisão do que sobra e o maior gasto.
import type { Allocation } from "./allocation";
import {
  planDividendRetirement,
  type DividendPlan,
  type DividendPlanInput,
} from "./dividend-retirement";
import { money, toDbAmount } from "./money";

export const MONTHLY_PLAN_RULES = {
  maxActions: 3,
  /** Quanto simular a mais por mês quando a divisão do que sobra não aponta um valor. */
  minExtra: "100.00",
  /** Fatia do maior gasto que entra na simulação. */
  categoryCut: "0.10",
} as const;

export type PlanActionKind = "completar" | "reserva" | "divida" | "guardar" | "gasto";

export interface PlanAction {
  kind: PlanActionKind;
  /** Valor por mês. Null em "completar". */
  amount: string | null;
  /** Anos a menos até a carteira fechar. Null quando não dá para calcular. */
  yearsEarlier: number | null;
  /** Nome da categoria, em "gasto". */
  category?: string;
}

export interface MonthlyPlanInput {
  base: DividendPlanInput;
  plan: DividendPlan;
  /** Aporte real do plano. */
  contribution: string;
  allocation: Pick<Allocation, "reserve" | "debt" | "retirement" | "alreadyInvesting">;
  /** Maior categoria de despesa do último mês fechado. */
  largestCategory: { name: string; amount: string } | null;
}

function yearsEarlier(input: MonthlyPlanInput, extra: string): number | null {
  const today = input.plan.yearWithContribution;
  if (today === null) return null;
  const contribution = toDbAmount(money(input.contribution).plus(extra));
  const next = planDividendRetirement({ ...input.base, contribution }).yearWithContribution;
  return next === null ? null : today - next;
}

/** Em ordem de prioridade: proteger, parar de perder juros e só então guardar mais. */
export function monthlyPlan(input: MonthlyPlanInput): PlanAction[] {
  const { allocation, contribution, largestCategory, plan } = input;
  if (plan.status !== "ok") return [{ kind: "completar", amount: null, yearsEarlier: null }];

  const actions: PlanAction[] = [];
  if (money(allocation.reserve).gt(0)) {
    actions.push({ kind: "reserva", amount: allocation.reserve, yearsEarlier: null });
  }
  if (money(allocation.debt).gt(0)) {
    actions.push({
      kind: "divida",
      amount: allocation.debt,
      yearsEarlier: yearsEarlier(input, allocation.debt),
    });
  }
  // Parte do que a divisão pede a família já faz: só o resto é guardar mais.
  const doing = money(allocation.alreadyInvesting).gt(contribution)
    ? allocation.alreadyInvesting
    : contribution;
  const gap = money(allocation.retirement).minus(doing);
  const extra = toDbAmount(gap.gt(MONTHLY_PLAN_RULES.minExtra) ? gap : MONTHLY_PLAN_RULES.minExtra);
  actions.push({ kind: "guardar", amount: extra, yearsEarlier: yearsEarlier(input, extra) });

  if (largestCategory && money(largestCategory.amount).gt(0)) {
    const cut = toDbAmount(money(largestCategory.amount).times(MONTHLY_PLAN_RULES.categoryCut));
    if (money(cut).gt(0)) {
      actions.push({
        kind: "gasto",
        amount: cut,
        yearsEarlier: yearsEarlier(input, cut),
        category: largestCategory.name,
      });
    }
  }
  return actions.slice(0, MONTHLY_PLAN_RULES.maxActions);
}
