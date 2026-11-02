// Agente diário de aposentadoria (ADR-0015). Mede o que sobra por mês, divide entre reserva,
// dívidas caras, aposentadoria, metas e viagens, e recalcula o plano por proventos com o aporte
// real. Tudo vira sugestão; a família decide. Estimativa, não promessa.
import {
  debtPlanReports,
  debts,
  eq,
  gte,
  householdCurrency,
  sql,
  tripCosts,
  tripPeople,
  trips,
  type TenantTx,
} from "@organizeup/db";
import {
  availableToAllocate,
  brazilRulesApply,
  isExpensiveDebt,
  money,
  planDividendRetirement,
  planTrip,
  suggestAllocation,
  toDbAmount,
  yearMonthOf,
  type Allocation,
  type Currency,
  type DividendPlan,
} from "@organizeup/domain";
import { dividendPlanInputs, reserveInputs, surplusInputs } from "./inputs";
import type { ReportAposentadoria } from "./reports";
import {
  DEDUPE,
  type AporteDividaPayload,
  type AporteInvestimentoPayload,
  type AporteReservaPayload,
  type LinkPayload,
} from "./suggestions";
import {
  loadDecisions,
  saveDailyReport,
  upsertPending,
  type AgentInput,
  type AgentResult,
  type PendingSuggestion,
} from "./shared";
import {
  aporteDividaText,
  aporteInvestimentoText,
  aporteReservaText,
  aposentadoriaReportText,
  reminderText,
  type ReminderKind,
} from "./texts";

export const APOSENTADORIA_AGENT = "aposentadoria";

export interface AposentadoriaResult extends AgentResult {
  allocation: Allocation;
  plan: DividendPlan;
}

interface DebtRow {
  id: string;
  name: string;
  monthlyRate: string;
  balance: string;
}

/** Dívidas ativas com saldo em aberto (soma da amortização das parcelas não pagas). */
async function openDebts(tx: TenantTx): Promise<DebtRow[]> {
  const rows = await tx
    .select({
      id: debts.id,
      name: debts.name,
      monthlyRate: debts.monthlyRate,
      balance: sql<string>`coalesce((
        select sum(i.principal) from debt_installments i
        where i.debt_id = debts.id and i.transaction_id is null
      ), 0)::text`,
    })
    .from(debts)
    .where(eq(debts.archived, false));
  return rows.filter((row) => money(row.balance).gt(0));
}

/** Quanto as viagens já marcadas pedem por mês, somadas. */
async function confirmedTripsMonthly(tx: TenantTx, today: string): Promise<string> {
  const rows = await tx.select().from(trips).where(gte(trips.startOn, today));
  if (rows.length === 0) return "0.00";
  const [costs, travelers] = await Promise.all([
    tx.select().from(tripCosts),
    tx.select().from(tripPeople),
  ]);
  return toDbAmount(
    rows.reduce((acc, trip) => {
      const plan = planTrip(
        {
          startOn: trip.startOn,
          saved: trip.saved,
          travelers: travelers.filter((row) => row.tripId === trip.id).length,
          costs: costs.filter((cost) => cost.tripId === trip.id),
        },
        today,
      );
      return plan.monthly ? acc.plus(plan.monthly) : acc;
    }, money(0)),
  );
}

/** Só lê: a divisão do que sobra, que também serve a quem tem Metas e não tem Aposentadoria. */
async function allocationContext(tx: TenantTx, today: string) {
  const currency = await householdCurrency(tx);

  const surplus = await surplusInputs(tx, { today });
  const reserve = await reserveInputs(tx, { today });
  const planData = await dividendPlanInputs(tx, {
    today,
    essentialMonthly: reserve.baseline.monthly,
    averageExpenses12: surplus.averageExpenses12,
  });
  // Primeiro com o aporte informado (ou zero): daqui sai quanto seria preciso guardar.
  const first = planDividendRetirement(planData.input);

  const debtRows = await openDebts(tx);
  const expensive = debtRows
    .filter((debt) => isExpensiveDebt(debt.monthlyRate, first.yieldUsed))
    .sort((a, b) => money(b.monthlyRate).comparedTo(a.monthlyRate));
  const expensiveDebtBalance = toDbAmount(
    expensive.reduce((acc, debt) => acc.plus(debt.balance), money(0)),
  );
  const tripsMonthly = await confirmedTripsMonthly(tx, today);

  const available = availableToAllocate(surplus.surplus);
  const allocation = suggestAllocation({
    available,
    reserveMissing: reserve.status.missing,
    expensiveDebtBalance,
    retirementRequired: first.requiredContribution,
    confirmedTripsMonthly: tripsMonthly,
    surplusMonths: surplus.result.months,
    currency,
  });
  return { currency, surplus, reserve, planData, first, expensive, available, allocation };
}

/** A divisão de hoje, sem gravar nada. Metas e viagens precisam dela mesmo sem o módulo de aposentadoria. */
export const currentAllocation = async (tx: TenantTx, today: string): Promise<Allocation> =>
  (await allocationContext(tx, today)).allocation;

export async function runAposentadoriaAgent(
  tx: TenantTx,
  input: AgentInput,
): Promise<AposentadoriaResult> {
  const { today, householdId } = input;
  const month = yearMonthOf(today);
  const { currency, surplus, reserve, planData, first, expensive, available, allocation } =
    await allocationContext(tx, today);
  // Depois com o aporte real: o informado pela família, senão o que a divisão sugere.
  const contribution = planData.plan?.monthlyContribution ?? allocation.retirement;
  const plan = planDividendRetirement({ ...planData.input, contribution });

  const pending: PendingSuggestion[] = [];
  if (money(allocation.reserve).gt(0) && allocation.reserve !== reserve.contribution) {
    const payload: AporteReservaPayload = {
      monthlyAmount: allocation.reserve,
      previous: reserve.contribution,
    };
    const months = money(allocation.reserve).gt(0)
      ? money(reserve.status.missing).dividedBy(allocation.reserve).ceil().toNumber()
      : null;
    pending.push({
      kind: "aporte_reserva",
      ...aporteReservaText({
        amount: allocation.reserve,
        missing: reserve.status.missing,
        targetMonths: reserve.targetMonths,
        months,
        currency,
      }),
      payload,
      dedupeKey: DEDUPE.aporteReserva(month),
    });
  }

  // Dívidas caras: o extra vai primeiro para a de juro maior. Quem decide é o agente de dívidas, que
  // roda antes; esta conta só vale no dia em que ele não rodou.
  const planned = await tx
    .select({ id: debtPlanReports.id })
    .from(debtPlanReports)
    .where(eq(debtPlanReports.day, today))
    .limit(1);
  let debtLeft = planned.length > 0 ? money(0) : money(allocation.debt);
  for (const debt of expensive) {
    if (debtLeft.lte(0)) break;
    const extra = debtLeft.gt(debt.balance) ? money(debt.balance) : debtLeft;
    debtLeft = debtLeft.minus(extra);
    const payload: AporteDividaPayload = { debtId: debt.id, extraMonthly: toDbAmount(extra) };
    pending.push({
      kind: "aporte_divida",
      ...aporteDividaText({
        amount: toDbAmount(extra),
        debt: debt.name,
        monthlyRate: debt.monthlyRate,
        currency,
      }),
      payload,
      dedupeKey: DEDUPE.aporteDivida(debt.id, month),
    });
  }

  if (
    money(allocation.retirement).gt(0) &&
    allocation.retirement !== (planData.plan?.monthlyContribution ?? null)
  ) {
    const payload: AporteInvestimentoPayload = {
      monthlyAmount: allocation.retirement,
      previous: planData.plan?.monthlyContribution ?? null,
    };
    const required = first.requiredContribution;
    const targetYear = planData.input.targetYear;
    pending.push({
      kind: "aporte_investimento",
      ...aporteInvestimentoText(
        allocation.retirement,
        plan.status !== "ok" || targetYear === null
          ? { kind: "incompleto" }
          : required !== null && money(allocation.retirement).gte(required)
            ? { kind: "fecha", targetYear }
            : { kind: "falta", targetYear, required, year: plan.yearWithContribution ?? null },
        currency,
      ),
      payload,
      dedupeKey: DEDUPE.aporteInvestimento(month),
    });
  }

  if (plan.status !== "ok") {
    const { href, ...reminder } = reminderText(reminderKind(plan.status, currency));
    const payload: LinkPayload = { href };
    pending.push({
      kind: "lembrete",
      ...reminder,
      payload,
      dedupeKey: DEDUPE.lembreteAposentadoria(),
    });
  }

  // Sem filtro de agente: `aporte_divida` pode ter nascido no agente de dívidas.
  const decisions = await loadDecisions(tx, today);
  const suggestions = await upsertPending(tx, householdId, APOSENTADORIA_AGENT, decisions, pending);

  const data: ReportAposentadoria = {
    plan,
    allocation,
    surplus: {
      result: surplus.result,
      basis: surplus.basis,
      surplus: surplus.surplus,
      available,
    },
  };
  const report = {
    ...aposentadoriaReportText({
      day: today,
      surplus: surplus.surplus,
      available,
      baseMonths: surplus.basis === "previsto" ? null : surplus.result.months,
      reserve: allocation.reserve,
      debt: allocation.debt,
      retirement: allocation.retirement,
      goals: allocation.goalsBudget,
      trips: allocation.tripsBudget,
      plan:
        plan.status === "ok"
          ? { targetIncome: plan.targetIncome ?? "0.00", coverage: plan.coverage ?? 0 }
          : null,
      currency,
    }),
    data,
  };
  await saveDailyReport(tx, householdId, APOSENTADORIA_AGENT, "aposentadoria", today, report);
  return { suggestions, applied: 0, report, allocation, plan };
}

/** Sem as regras brasileiras não há tela de proventos, então o lembrete não manda para lá. */
function reminderKind(status: DividendPlan["status"], currency: Currency): ReminderKind {
  if (status === "sem_yield") return brazilRulesApply(currency) ? status : "sem_yield_simples";
  return status === "sem_ano" ? status : "outro";
}
