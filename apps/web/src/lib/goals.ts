import "server-only";
import {
  accounts,
  asc,
  eq,
  goalContributions,
  goals,
  householdTimezone,
  incomeSources,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import {
  money,
  occurrenceDate,
  toDbAmount,
  todayIn,
  yearMonthOf,
  type YearMonth,
} from "@organizeup/domain";
import { agentSentence } from "@/i18n/agent-text";
import { resolveLocale } from "@/i18n/resolve";

const DEFAULT_PLAN_DAY = 5;
const LAST_PLAN_DAY = 28;

/** Um dia depois do pagamento da maior renda: é quando há dinheiro para separar. */
function suggestedPlanDay(incomes: Array<{ amount: string; payDay: number }>) {
  const biggest = incomes.reduce<(typeof incomes)[number] | null>(
    (top, income) => (!top || money(income.amount).gt(top.amount) ? income : top),
    null,
  );
  return biggest ? Math.min(biggest.payDay + 1, LAST_PLAN_DAY) : DEFAULT_PLAN_DAY;
}

/** Dados da tela de metas. O plano (colunas plan_*) vem pronto do assistente diário. */
export async function loadGoals(ctx: TenantContext) {
  const locale = await resolveLocale();
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const month = yearMonthOf(today);
    const goalRows = await tx
      .select()
      .from(goals)
      .orderBy(asc(goals.priority), asc(goals.createdAt));
    const contributions = await tx
      .select()
      .from(goalContributions)
      .orderBy(asc(goalContributions.month));
    const accountRows = await tx
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(eq(accounts.archived, false))
      .orderBy(asc(accounts.createdAt));
    const incomes = await tx
      .select({
        amount: incomeSources.amount,
        payDay: incomeSources.payDay,
        startMonth: incomeSources.startMonth,
        endMonth: incomeSources.endMonth,
      })
      .from(incomeSources);

    const upcoming: Array<{ month: YearMonth; amount: string }> = [];
    const views = goalRows.map((goal) => {
      const active = goal.status !== "pausada" && goal.status !== "concluida";
      const open = contributions
        .filter((row) => row.goalId === goal.id && row.transactionId === null)
        .map((row) => ({
          key: `g:${goal.id}:${row.month}`,
          month: row.month,
          amount: row.amount,
          date: occurrenceDate(goal.planDay, row.month),
        }));
      const payable = active && goal.accountId !== null ? open : [];
      upcoming.push(...payable.filter((row) => row.date >= today));
      const missing = money(goal.targetAmount).minus(goal.saved);
      return {
        id: goal.id,
        name: goal.name,
        kind: goal.kind,
        targetAmount: goal.targetAmount,
        saved: goal.saved,
        missing: toDbAmount(missing.gt(0) ? missing : 0),
        percent: Math.min(
          100,
          money(goal.saved).dividedBy(goal.targetAmount).times(100).floor().toNumber(),
        ),
        desiredMonth: goal.desiredMonth,
        priority: goal.priority,
        status: goal.status,
        active,
        planDay: goal.planDay,
        accountId: goal.accountId,
        destinationAccountId: goal.destinationAccountId,
        planStart: goal.planStart,
        planEnd: goal.planEnd,
        planMonthly: goal.planMonthly,
        planNote: goal.planNote
          ? agentSentence(goal.planNote, goal.planNoteKey, goal.planNoteParams, locale)
          : null,
        /** A tela já diz isso com outras palavras. */
        planNoteNoRoom: goal.planNote?.startsWith("Hoje não sobra") ?? false,
        planned: goal.planUpdatedAt !== null,
        overdue: payable.filter((row) => row.date < today),
      };
    });

    const nextMonth = upcoming.map((row) => row.month).sort()[0] ?? null;
    const next = views
      .filter((goal) => goal.active && goal.planEnd !== null)
      .sort((a, b) => a.planEnd!.localeCompare(b.planEnd!))[0];

    return {
      today,
      accounts: accountRows,
      defaults: {
        planDay: suggestedPlanDay(
          incomes.filter(
            (row) => row.startMonth <= month && (row.endMonth === null || row.endMonth >= month),
          ),
        ),
        accountId: accountRows[0]?.id ?? "",
      },
      goals: views,
      nextMonth,
      nextMonthTotal: toDbAmount(
        upcoming
          .filter((row) => row.month === nextMonth)
          .reduce((acc, row) => acc.plus(row.amount), money(0)),
      ),
      nextGoal: next ? { name: next.name, end: next.planEnd! } : null,
    };
  });
}
