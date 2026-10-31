// Agente diário de metas (ADR-0016). Recalcula o plano mensal de cada meta com o orçamento de
// metas da divisão do dia: parcelas (goal_contributions sem transaction_id) e colunas plan_* são
// dado derivado e são reescritas; valor, data e prioridade só mudam por sugestão aceita.
import {
  asc,
  ensureFinanceDefaults,
  eq,
  goalContributions,
  goals,
  inArray,
  type TenantTx,
} from "@organizeup/db";
import {
  formatBRL,
  formatYearMonth,
  Money,
  money,
  monthsBetween,
  planGoals,
  toDbAmount,
  yearMonthOf,
  type GoalInput,
  type GoalPlan,
} from "@organizeup/domain";
import type { ReportMetas } from "./reports";
import { DEDUPE, type MetaPayload } from "./suggestions";
import {
  clamp,
  loadDecisions,
  plural,
  recordAudit,
  resolveAllocation,
  saveDailyReport,
  systemActor,
  upsertPending,
  type AgentInput,
  type AgentResult,
  type PendingSuggestion,
} from "./shared";

export const METAS_AGENT = "metas";
const MAX_NOTE = 400;

export async function runMetasAgent(tx: TenantTx, input: AgentInput): Promise<AgentResult> {
  const { today, householdId } = input;
  const month = yearMonthOf(today);
  const day = Number(today.slice(8, 10));
  await ensureFinanceDefaults(tx, householdId);

  const goalRows = await tx.select().from(goals).orderBy(asc(goals.createdAt));
  const finish = async (
    budget: string,
    plans: GoalPlan[],
    summary: string,
    suggestions: number,
  ) => {
    const data: ReportMetas = { budget, goals: plans };
    const report = { title: `Metas em ${today}`, summary, data };
    await saveDailyReport(tx, householdId, METAS_AGENT, "metas", today, report);
    return { suggestions, applied: 0, report };
  };
  if (goalRows.length === 0) {
    return finish("0.00", [], "Nenhuma meta cadastrada ainda.", 0);
  }
  const allocation = await resolveAllocation(tx, input);
  if (!allocation) {
    return finish("0.00", [], "Sem a divisão do que sobra hoje; o plano das metas foi mantido.", 0);
  }

  const contributions = await tx.select().from(goalContributions);
  const confirmedOf = (goalId: string) =>
    contributions
      .filter((row) => row.goalId === goalId && row.transactionId !== null)
      .map((row) => row.month);
  // A parcela deste mês cujo dia já passou fica aberta até o mês virar, para a família poder dizer
  // que guardou. Ela sai do que falta planejar; só nos meses seguintes é redistribuída.
  const heldOf = new Map(
    goalRows.flatMap((goal) => {
      const active = goal.status === "planejando" || goal.status === "juntando";
      const open = contributions.find(
        (row) => row.goalId === goal.id && row.month === month && row.transactionId === null,
      );
      return active && open && day > goal.planDay ? [[goal.id, open] as const] : [];
    }),
  );
  const inputs: GoalInput[] = goalRows.map((goal) => {
    const held = heldOf.get(goal.id);
    return {
      id: goal.id,
      name: goal.name,
      targetAmount: goal.targetAmount,
      saved: held ? toDbAmount(money(goal.saved).plus(held.amount)) : goal.saved,
      desiredMonth: goal.desiredMonth,
      priority: goal.priority,
      status: goal.status,
      confirmedMonths: held ? [...confirmedOf(goal.id), month] : confirmedOf(goal.id),
      planDayPassed: day > goal.planDay,
    };
  });
  const plans = planGoals({
    today,
    planDayPassed: false,
    budget: allocation.goalsBudget,
    goals: inputs,
  });

  // Parcelas previstas são recriadas do zero; as confirmadas (com lançamento) ficam intocadas.
  const heldIds = new Set([...heldOf.values()].map((row) => row.id));
  const stale = contributions
    .filter((row) => row.transactionId === null && !heldIds.has(row.id))
    .map((row) => row.id);
  if (stale.length > 0)
    await tx.delete(goalContributions).where(inArray(goalContributions.id, stale));

  const byId = new Map(goalRows.map((goal) => [goal.id, goal]));
  const pending: PendingSuggestion[] = [];
  let planned = 0;
  let onTime = 0;
  let noRoom = 0;
  for (const plan of plans) {
    const goal = byId.get(plan.id)!;
    const notes = [plan.note];
    const held = heldOf.get(goal.id);
    const missing = money(goal.targetAmount)
      .minus(goal.saved)
      .minus(held?.amount ?? 0);

    if (plan.monthly !== null) {
      planned += 1;
      if (plan.onTime) onTime += 1;
      if (goal.accountId === null) {
        notes.push("Escolha a conta de onde sai a parcela para ela entrar no calendário.");
      } else if (plan.contributions.length > 0) {
        await tx
          .insert(goalContributions)
          .values(
            plan.contributions.map((item) => ({
              householdId,
              goalId: goal.id,
              month: item.month,
              amount: item.amount,
            })),
          )
          .onConflictDoNothing();
      }
      if (goal.planMonthly !== null && goal.planMonthly !== plan.monthly) {
        notes.push(
          `Parcela ajustada de ${formatBRL(goal.planMonthly)} para ${formatBRL(plan.monthly)}.`,
        );
      }
    } else if (plan.status !== "concluida" && plan.status !== "pausada") {
      noRoom += 1;
    }

    const note = notes.filter(Boolean).join(" ");
    await tx
      .update(goals)
      .set({
        // Só a parcela aberta completaria a meta: conclui quando a família confirmar.
        status: held && plan.status === "concluida" ? "juntando" : plan.status,
        planStart: plan.start,
        planEnd: plan.end,
        planMonthly: plan.monthly,
        planNote: note ? clamp(note, MAX_NOTE) : null,
        planUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(goals.id, goal.id));

    // Não cabe no prazo, prazo passou ou não há espaço: sugere ajustar a data desejada.
    const active = plan.status !== "concluida" && plan.status !== "pausada" && missing.gt(0);
    if (active && (plan.onTime === false || plan.monthly === null)) {
      const payload: MetaPayload = {
        goalId: goal.id,
        proposedMonth: plan.end,
        extraMonthly: extraMonthlyFor(goal.desiredMonth, plan, missing),
      };
      pending.push({
        kind: "meta",
        title: plan.monthly
          ? `A meta ‘${goal.name}’ não cabe no prazo`
          : `Hoje não sobra para a meta ‘${goal.name}’`,
        body: bodyFor(goal.name, goal.desiredMonth, plan, payload.extraMonthly),
        payload,
        dedupeKey: DEDUPE.meta(goal.id, month),
      });
    }
  }
  await recordAudit(tx, systemActor(householdId), "agente:metas", "goals", null, {
    goals: goalRows.length,
    planned,
  });

  const decisions = await loadDecisions(tx, today, METAS_AGENT);
  const suggestions = await upsertPending(tx, householdId, METAS_AGENT, decisions, pending);
  const summary =
    `${plural(goalRows.length, "meta", "metas")}; ${formatBRL(allocation.goalsBudget)} por mês para ` +
    `metas. ${plural(planned, "meta com plano", "metas com plano")}, ${onTime} dentro do prazo, ` +
    `${plural(noRoom, "sem espaço no orçamento", "sem espaço no orçamento")}.`;
  return finish(allocation.goalsBudget, plans, summary, suggestions);
}

/** Quanto a mais por mês fecharia a meta na data desejada. Null sem data ou quando já passou. */
function extraMonthlyFor(
  desiredMonth: string | null,
  plan: GoalPlan,
  missing: ReturnType<typeof money>,
): string | null {
  if (desiredMonth === null || plan.start === null || desiredMonth < plan.start) return null;
  const months = monthsBetween(plan.start, desiredMonth) + 1;
  const needed = missing.dividedBy(months).toDecimalPlaces(2, Money.ROUND_UP);
  const extra = needed.minus(plan.monthly ?? 0);
  return extra.gt(0) ? toDbAmount(extra) : null;
}

function bodyFor(
  name: string,
  desiredMonth: string | null,
  plan: GoalPlan,
  extraMonthly: string | null,
): string {
  const parts: string[] = [];
  if (plan.monthly && plan.end) {
    parts.push(
      `Hoje dá para guardar ${formatBRL(plan.monthly)} por mês para ‘${name}’, o que termina em ` +
        `${formatYearMonth(plan.end)}.`,
    );
  } else {
    parts.push(`Hoje não sobra orçamento para ‘${name}’.`);
  }
  if (desiredMonth && extraMonthly) {
    parts.push(
      `Para conquistar em ${formatYearMonth(desiredMonth)} seria preciso ${formatBRL(extraMonthly)} a mais por mês.`,
    );
  } else if (desiredMonth && plan.note) {
    parts.push(plan.note);
  }
  parts.push(
    plan.end
      ? `Aceitar muda a data desejada para ${formatYearMonth(plan.end)}; ou reduza o valor, pause outra meta ou aumente o que guarda.`
      : "Reduza o valor, adie a data ou pause outra meta para abrir espaço.",
  );
  return parts.join(" ");
}
