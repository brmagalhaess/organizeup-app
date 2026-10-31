// Plano de aposentadoria recalculado a cada leitura, compartilhado pela tela e pelo assistente.
// Rode dentro de withHousehold.
import {
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
  isExpensiveDebt,
  money,
  planDividendRetirement,
  planTrip,
  suggestAllocation,
  toDbAmount,
} from "@organizeup/domain";
import { dividendPlanInputs, reserveInputs, surplusInputs } from "./inputs";

/** Saldo das dívidas caras. Mesma leitura de run-aposentadoria.ts, que não exporta a sua. */
async function expensiveDebtBalance(tx: TenantTx, yieldUsed: string | null): Promise<string> {
  const rows = await tx
    .select({
      monthlyRate: debts.monthlyRate,
      balance: sql<string>`coalesce((
        select sum(i.principal) from debt_installments i
        where i.debt_id = debts.id and i.transaction_id is null
      ), 0)::text`,
    })
    .from(debts)
    .where(eq(debts.archived, false));
  return toDbAmount(
    rows
      .filter((row) => money(row.balance).gt(0) && isExpensiveDebt(row.monthlyRate, yieldUsed))
      .reduce((acc, row) => acc.plus(row.balance), money(0)),
  );
}

/** Quanto as viagens já marcadas pedem por mês. Mesma conta de run-aposentadoria.ts. */
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

/**
 * Plano de viver dos rendimentos com os mesmos passos do agente de aposentadoria: primeiro descobre
 * quanto seria preciso guardar, divide o que sobra e refaz a projeção com o valor real (o informado
 * pela família, senão o da divisão). `input` e `contribution` servem de base para simular.
 */
export async function currentDividendPlan(tx: TenantTx, today: string) {
  const surplus = await surplusInputs(tx, { today });
  const reserve = await reserveInputs(tx, { today });
  const planData = await dividendPlanInputs(tx, {
    today,
    essentialMonthly: reserve.baseline.monthly,
    averageExpenses12: surplus.averageExpenses12,
  });
  const first = planDividendRetirement(planData.input);
  const allocation = suggestAllocation({
    available: availableToAllocate(surplus.surplus),
    reserveMissing: reserve.status.missing,
    expensiveDebtBalance: await expensiveDebtBalance(tx, first.yieldUsed),
    retirementRequired: first.requiredContribution,
    confirmedTripsMonthly: await confirmedTripsMonthly(tx, today),
    surplusMonths: surplus.result.months,
  });
  const informed = planData.plan?.monthlyContribution ?? null;
  const contribution = informed ?? allocation.retirement;
  const plan = planDividendRetirement({ ...planData.input, contribution });
  return { plan, planData, contribution, informed, allocation, surplus, reserve };
}
