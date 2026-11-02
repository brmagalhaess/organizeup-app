import "server-only";
import { currentDividendPlan, monthlyPlanView } from "@organizeup/agents";
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
/** Tela Seu plano: as ações do mês e o ano em que a carteira fecha. */
export async function loadMonthlyPlan(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const { actions, plan, targetYear } = await monthlyPlanView(tx, today);
    return { actions, targetYear, year: plan.yearWithContribution };
  });
}

export async function loadDividendPlan(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const { plan, planData, contribution, informed, allocation, surplus, reserve } =
      await currentDividendPlan(tx, today);
    // O valor aceito só sobe: sugestão menor que ele não vira botão de aceitar.
    const matches = (suggested: string, saved: string | null) =>
      money(suggested).isZero() || (saved !== null && money(saved).gte(suggested));
    const atLeast = (suggested: string, saved: string | null) =>
      saved !== null && money(saved).gt(suggested) ? saved : suggested;

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
        /** Parte de `investment` que já sai todo mês. */
        alreadyInvesting: allocation.alreadyInvesting,
        /** O que reserva e dívidas caras pedem além do que sobra, por causa do que já sai. */
        short: toDbAmount(money(allocation.reserveShort).plus(allocation.debtShort)),
        /** O que aceitar grava: nunca menos que o valor que a família já aceitou. */
        accept: {
          reserve: atLeast(allocation.reserve, reserve.contribution),
          investment: atLeast(allocation.retirement, informed),
        },
        accepted:
          matches(allocation.reserve, reserve.contribution) &&
          (matches(allocation.retirement, informed) ||
            money(allocation.retirement).lte(allocation.alreadyInvesting)),
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
