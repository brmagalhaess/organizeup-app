import "server-only";
import { dividendPlanInputs, reserveInputs, surplusInputs } from "@organizeup/agents";
import {
  asc,
  debts,
  eq,
  gte,
  householdTimezone,
  investments,
  investmentTrades,
  people,
  retirementScenarios,
  sql,
  tripCosts,
  tripPeople,
  trips,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  availableToAllocate,
  isExpensiveDebt,
  money,
  planDividendRetirement,
  planTrip,
  projectRetirement,
  suggestAllocation,
  summarizePortfolio,
  toDbAmount,
  todayIn,
} from "@organizeup/domain";

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
 * Plano de viver dos rendimentos, recalculado a cada leitura com os mesmos passos do agente de
 * aposentadoria: primeiro descobre quanto seria preciso guardar, divide o que sobra e refaz a
 * projeção com o valor real (o informado pela família, senão o da divisão).
 */
export async function loadDividendPlan(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
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
    const matches = (suggested: string, saved: string | null) =>
      money(suggested).isZero() || (saved !== null && money(saved).eq(suggested));

    return {
      plan,
      targetYear: planData.input.targetYear,
      contribution,
      surplus: { basis: surplus.basis, months: surplus.result.months },
      suggested: {
        reserve: allocation.reserve,
        investment: allocation.retirement,
        debt: allocation.debt,
        total: toDbAmount(money(allocation.reserve).plus(allocation.retirement)),
        accepted:
          matches(allocation.reserve, reserve.contribution) &&
          matches(allocation.retirement, informed),
      },
      form: {
        targetIncome: planData.plan?.targetIncome ?? null,
        expectedYield: planData.plan?.expectedYield ?? null,
        dividendGrowth: planData.plan?.dividendGrowth ?? "0.00",
        monthlyContribution: informed,
      },
    };
  });
}

/** Cenários de aposentadoria, com o resultado recalculado a cada leitura. */
export async function loadRetirement(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const [year, month] = today.split("-").map(Number) as [number, number];
    const [personRows, scenarios, holdings, trades] = await Promise.all([
      tx.select().from(people).orderBy(asc(people.createdAt)),
      tx.select().from(retirementScenarios).orderBy(asc(retirementScenarios.createdAt)),
      tx.select().from(investments),
      tx.select().from(investmentTrades),
    ]);
    const portfolio = summarizePortfolio(
      holdings.map((holding) => ({
        ...holding,
        trades: trades.filter((trade) => trade.investmentId === holding.id),
      })),
    ).total;
    const ageMonths = (person: (typeof personRows)[number]) =>
      person.birthYear && person.birthMonth
        ? year * 12 + month - (person.birthYear * 12 + person.birthMonth)
        : null;

    return {
      portfolio,
      people: personRows.map((person) => ({
        id: person.id,
        name: person.name,
        hasBirth: ageMonths(person) !== null,
      })),
      scenarios: scenarios.flatMap((scenario) => {
        const person = personRows.find((row) => row.id === scenario.personId);
        const age = person ? ageMonths(person) : null;
        if (!person || age === null) return [];
        return [
          {
            ...scenario,
            personName: person.name,
            age: Math.floor(age / 12),
            result: projectRetirement({
              ...scenario,
              ageMonths: age,
              saved: scenario.saved ?? portfolio,
            }),
          },
        ];
      }),
    };
  });
}

/** Viagens com o plano de cada uma, da mais próxima para a mais distante. */
export async function loadTrips(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const [tripRows, costs, travelers, personRows] = await Promise.all([
      tx.select().from(trips).orderBy(asc(trips.startOn)),
      tx.select().from(tripCosts).orderBy(asc(tripCosts.createdAt)),
      tx.select().from(tripPeople),
      tx.select({ id: people.id, name: people.name }).from(people).orderBy(asc(people.createdAt)),
    ]);
    const nameOf = new Map(personRows.map((person) => [person.id, person.name]));
    return {
      today,
      people: personRows,
      trips: tripRows.map((trip) => {
        const going = travelers.filter((row) => row.tripId === trip.id);
        const tripCostRows = costs.filter((cost) => cost.tripId === trip.id);
        return {
          ...trip,
          costs: tripCostRows,
          personIds: going.map((row) => row.personId),
          names: going.map((row) => nameOf.get(row.personId) ?? ""),
          plan: planTrip({ ...trip, travelers: going.length, costs: tripCostRows }, today),
        };
      }),
    };
  });
}
