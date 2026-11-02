// Agente diário de metas (ADR-0016). Recalcula o plano mensal de cada meta com o orçamento de
// metas da divisão do dia: parcelas (goal_contributions sem transaction_id) e colunas plan_* são
// dado derivado e são reescritas; valor, data e prioridade só mudam por sugestão aceita.
import {
  asc,
  ensureFinanceDefaults,
  eq,
  goalContributions,
  goals,
  householdCurrency,
  inArray,
  type TenantTx,
} from "@organizeup/db";
import {
  Money,
  money,
  monthsBetween,
  planGoals,
  toDbAmount,
  yearMonthOf,
  type GoalInput,
  type GoalPlan,
  type Message,
} from "@organizeup/domain";
import type { ReportMetas } from "./reports";
import { DEDUPE, type MetaPayload } from "./suggestions";
import {
  clamp,
  loadDecisions,
  recordAudit,
  resolveAllocation,
  saveDailyReport,
  systemActor,
  upsertPending,
  type AgentInput,
  type AgentResult,
  type PendingSuggestion,
} from "./shared";
import {
  metaNotaContaText,
  metaNotaMessage,
  metaNotaParcelaText,
  metaPlanoMantidoText,
  metasReportText,
  metaText,
  type MetasReportInput,
} from "./texts";

export const METAS_AGENT = "metas";
const MAX_NOTE = 400;

export async function runMetasAgent(tx: TenantTx, input: AgentInput): Promise<AgentResult> {
  const { today, householdId } = input;
  const month = yearMonthOf(today);
  const day = Number(today.slice(8, 10));
  await ensureFinanceDefaults(tx, householdId);
  const currency = await householdCurrency(tx);

  const goalRows = await tx.select().from(goals).orderBy(asc(goals.createdAt));
  const finish = async (
    budget: string,
    plans: GoalPlan[],
    text: MetasReportInput,
    suggestions: number,
  ) => {
    const data: ReportMetas = { budget, goals: plans };
    const report = { ...metasReportText(text), data };
    await saveDailyReport(tx, householdId, METAS_AGENT, "metas", today, report);
    return { suggestions, applied: 0, report };
  };
  if (goalRows.length === 0) {
    return finish("0.00", [], { day: today, kind: "nenhuma" }, 0);
  }
  const allocation = await resolveAllocation(tx, input);
  if (!allocation) {
    return finish("0.00", [], { day: today, kind: "sem_divisao" }, 0);
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
    currency,
  });

  // Falta de sobra não apaga plano (ADR-0027): meta que já tinha plano, não coube e ainda tem parcela
  // por vir fica como está, com um aviso. Parcela que já passou sai, e sem nenhuma por vir não há plano a
  // manter: a meta volta ao caminho normal de quem não tem orçamento.
  const upcoming = (row: (typeof contributions)[number]) =>
    row.transactionId === null && row.month >= month;
  const noRoomOf = (plan: GoalPlan) =>
    plan.monthly === null && plan.status !== "concluida" && plan.status !== "pausada";
  const keptIds = new Set(
    plans
      .filter(
        (plan) =>
          noRoomOf(plan) &&
          byIdOf(goalRows, plan.id)?.planMonthly != null &&
          contributions.some((row) => row.goalId === plan.id && upcoming(row)),
      )
      .map((plan) => plan.id),
  );

  // Parcelas previstas são recriadas do zero; as confirmadas (com lançamento) ficam intocadas.
  const heldIds = new Set([...heldOf.values()].map((row) => row.id));
  const stale = contributions
    .filter(
      (row) =>
        row.transactionId === null &&
        !heldIds.has(row.id) &&
        !(keptIds.has(row.goalId) && upcoming(row)),
    )
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
    const noteMessages: Message[] = [...plan.noteMessages];
    const held = heldOf.get(goal.id);
    const missing = money(goal.targetAmount)
      .minus(goal.saved)
      .minus(held?.amount ?? 0);

    if (keptIds.has(goal.id)) {
      noRoom += 1;
      const kept = metaPlanoMantidoText();
      const noteMessage = metaNotaMessage([kept.message]);
      await tx
        .update(goals)
        .set({
          planNote: clamp(kept.text, MAX_NOTE),
          planNoteKey: noteMessage.key,
          planNoteParams: noteMessage.params,
          planUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(goals.id, goal.id));
      continue;
    }

    if (plan.monthly !== null) {
      planned += 1;
      if (plan.onTime) onTime += 1;
      if (goal.accountId === null) {
        const missingAccount = metaNotaContaText();
        notes.push(missingAccount.text);
        noteMessages.push(missingAccount.message);
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
        const adjusted = metaNotaParcelaText(goal.planMonthly, plan.monthly, currency);
        notes.push(adjusted.text);
        noteMessages.push(adjusted.message);
      }
    } else if (plan.status !== "concluida" && plan.status !== "pausada") {
      noRoom += 1;
    }

    const note = notes.filter(Boolean).join(" ");
    const noteMessage = noteMessages.length > 0 ? metaNotaMessage(noteMessages) : null;
    await tx
      .update(goals)
      .set({
        // Só a parcela aberta completaria a meta: conclui quando a família confirmar.
        status: held && plan.status === "concluida" ? "juntando" : plan.status,
        planStart: plan.start,
        planEnd: plan.end,
        planMonthly: plan.monthly,
        planNote: note ? clamp(note, MAX_NOTE) : null,
        planNoteKey: noteMessage?.key ?? null,
        planNoteParams: noteMessage?.params ?? null,
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
        ...metaText({
          name: goal.name,
          desiredMonth: goal.desiredMonth,
          plan,
          extraMonthly: payload.extraMonthly,
          currency,
        }),
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
  return finish(
    allocation.goalsBudget,
    plans,
    {
      day: today,
      kind: "plano",
      currency,
      goals: goalRows.length,
      budget: allocation.goalsBudget,
      planned,
      onTime,
      noRoom,
    },
    suggestions,
  );
}

const byIdOf = <T extends { id: string }>(rows: T[], id: string) =>
  rows.find((row) => row.id === id);

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
