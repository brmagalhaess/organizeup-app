// Agente diário de aposentadoria (ADR-0015). Mede o que sobra por mês, divide entre reserva,
// dívidas caras, aposentadoria, metas e viagens, e recalcula o plano por proventos com o aporte
// real. Tudo vira sugestão; a família decide. Estimativa, não promessa.
import {
  debtPlanReports,
  debts,
  eq,
  gte,
  sql,
  tripCosts,
  tripPeople,
  trips,
  type TenantTx,
} from "@organizeup/db";
import {
  availableToAllocate,
  formatBRL,
  isExpensiveDebt,
  money,
  planDividendRetirement,
  planTrip,
  suggestAllocation,
  toDbAmount,
  yearMonthOf,
  type Allocation,
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

export async function runAposentadoriaAgent(
  tx: TenantTx,
  input: AgentInput,
): Promise<AposentadoriaResult> {
  const { today, householdId } = input;
  const month = yearMonthOf(today);

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
  });
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
      title: `Guardar ${formatBRL(allocation.reserve)} por mês na reserva de emergência`,
      body:
        `Faltam ${formatBRL(reserve.status.missing)} para a reserva de ${reserve.targetMonths} meses ` +
        `de gastos essenciais.${months ? ` Com este valor ela fecha em ${months} ${months === 1 ? "mês" : "meses"}.` : ""} ` +
        `Aceitar grava este valor como o quanto guardar por mês na reserva.`,
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
      title: `Pagar ${formatBRL(extra)} a mais por mês em ‘${debt.name}’`,
      body:
        `Essa dívida custa ${money(debt.monthlyRate).toDecimalPlaces(2).toString().replace(".", ",")}% ao mês, ` +
        `mais do que a carteira rende. Quitar antes rende mais que investir. Aceitar registra a ` +
        `decisão; o pagamento extra você faz na tela de dívidas.`,
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
    let detail: string;
    if (plan.status !== "ok") {
      detail = "Complete o plano de aposentadoria para ver em que ano a carteira fecha.";
    } else if (required !== null && money(allocation.retirement).gte(required)) {
      detail = `Com este valor a carteira fecha em ${planData.input.targetYear}.`;
    } else {
      detail =
        `Para fechar em ${planData.input.targetYear} seria preciso ${required ? formatBRL(required) : "mais"} por mês; ` +
        `com ${formatBRL(allocation.retirement)} a carteira fecha em ` +
        `${plan.yearWithContribution ?? "mais de 60 anos"}.`;
    }
    pending.push({
      kind: "aporte_investimento",
      title: `Guardar ${formatBRL(allocation.retirement)} por mês para a aposentadoria`,
      body: `${detail} Aceitar grava este valor como o quanto guardar por mês no plano.`,
      payload,
      dedupeKey: DEDUPE.aporteInvestimento(month),
    });
  }

  if (plan.status !== "ok") {
    const reminder = reminderFor(plan.status);
    const payload: LinkPayload = { href: reminder.href };
    pending.push({
      kind: "lembrete",
      title: reminder.title,
      body: reminder.body,
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
  const basisText =
    surplus.basis === "previsto"
      ? "previsto pela renda e pelas despesas recorrentes"
      : `base de ${surplus.result.months} ${surplus.result.months === 1 ? "mês" : "meses"}`;
  const summary =
    `Sobra típica de ${formatBRL(surplus.surplus)} por mês (${basisText}); ` +
    `${formatBRL(available)} para dividir depois da folga. Divisão: ${formatBRL(allocation.reserve)} ` +
    `na reserva, ${formatBRL(allocation.debt)} em dívidas caras, ${formatBRL(allocation.retirement)} ` +
    `para a aposentadoria, ${formatBRL(allocation.goalsBudget)} para metas e ` +
    `${formatBRL(allocation.tripsBudget)} para viagens.` +
    (plan.status === "ok"
      ? ` Renda alvo ${formatBRL(plan.targetIncome ?? "0")}; a carteira já cobre ${plan.coverage}% do que falta.`
      : " O plano de aposentadoria ainda está incompleto.");
  const report = { title: `Divisão do que sobra em ${today}`, summary, data };
  await saveDailyReport(tx, householdId, APOSENTADORIA_AGENT, "aposentadoria", today, report);
  return { suggestions, applied: 0, report, allocation, plan };
}

function reminderFor(status: DividendPlan["status"]): {
  title: string;
  body: string;
  href: string;
} {
  switch (status) {
    case "sem_yield":
      return {
        title: "Informe o rendimento anual da carteira",
        body:
          "Ou registre os proventos recebidos. Sem isso o assistente não consegue calcular quanto " +
          "precisa ter investido para viver dos rendimentos.",
        href: "/app/aposentadoria",
      };
    case "sem_ano":
      return {
        title: "Diga em que ano querem parar de trabalhar",
        body:
          "Com o ano, o assistente calcula quanto guardar por mês para a carteira pagar as contas " +
          "até lá.",
        href: "/app/completar",
      };
    default:
      return {
        title: "Complete seu plano de aposentadoria",
        body:
          "Informe a renda que você quer por mês ou registre seus gastos. Com isso o assistente " +
          "estima quanto guardar por mês.",
        href: "/app/completar",
      };
  }
}
