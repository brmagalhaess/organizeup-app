import "server-only";
import { currentDividendPlan } from "@organizeup/agents";
import {
  asc,
  householdTimezone,
  investments,
  investmentTrades,
  loadStockEvents,
  people,
  retirementScenarios,
  tripCosts,
  tripPeople,
  trips,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import {
  money,
  planTrip,
  projectRetirement,
  summarizePortfolio,
  toDbAmount,
  todayIn,
} from "@organizeup/domain";

/** Plano de viver dos rendimentos, recalculado a cada leitura. */
export async function loadDividendPlan(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const { plan, planData, contribution, informed, allocation, surplus, reserve } =
      await currentDividendPlan(tx, today);
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
    const events = await loadStockEvents(tx);
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
        events: events.filter((event) => event.investmentId === holding.id),
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
