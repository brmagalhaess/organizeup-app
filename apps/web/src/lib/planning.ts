import "server-only";
import {
  asc,
  householdTimezone,
  investments,
  investmentTrades,
  people,
  retirementScenarios,
  tripCosts,
  tripPeople,
  trips,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import { planTrip, projectRetirement, summarizePortfolio, todayIn } from "@organizeup/domain";

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
