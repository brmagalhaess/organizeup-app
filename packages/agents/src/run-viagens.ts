// Agente diário de viagens (ADR-0015). Com `trips_per_year > 0`, sugere destinos que cabem no
// orçamento de viagens da divisão do dia. Só sugere: nada entra no calendário sem a família aceitar.
import {
  and,
  eq,
  gte,
  householdSettings,
  householdSuggestions,
  inArray,
  people,
  sql,
  tripDestinationTemplates,
  trips,
  type TenantTx,
} from "@organizeup/db";
import {
  addMonths,
  ageFromBirth,
  money,
  suggestTrips,
  yearMonthOf,
  type DestinationTemplate,
  type TripSuggestion,
  type TripTraveler,
} from "@organizeup/domain";
import type { ReportViagens } from "./reports";
import { DEDUPE, type ViagemPayload } from "./suggestions";
import {
  loadDecisions,
  resolveAllocation,
  saveDailyReport,
  upsertPending,
  type AgentInput,
  type AgentResult,
  type PendingSuggestion,
} from "./shared";
import { viagemText, viagensReportText, type ViagensReportInput } from "./texts";

export const VIAGENS_AGENT = "viagens";

/** Lê a tabela global de destinos já no formato do domínio (`best_months` vira number[]). */
export async function loadDestinations(tx: TenantTx): Promise<DestinationTemplate[]> {
  const rows = await tx.select().from(tripDestinationTemplates);
  return rows
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((row) => ({
      id: row.id,
      name: row.name,
      country: row.country,
      region: row.region,
      lodgingPerNight: row.lodgingPerNight,
      foodPerPersonDay: row.foodPerPersonDay,
      localTransportPerPersonDay: row.localTransportPerPersonDay,
      flightPerPerson: row.flightPerPerson,
      minDays: row.minDays,
      kidsFriendly: row.kidsFriendly,
      bestMonths: row.bestMonths
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12),
      source: row.source,
      confidence: row.confidence,
    }));
}

export async function runViagensAgent(tx: TenantTx, input: AgentInput): Promise<AgentResult> {
  const { today, householdId } = input;
  const month = yearMonthOf(today);
  const [settings] = await tx.select().from(householdSettings);
  const tripsPerYear = settings?.tripsPerYear ?? 0;

  const future = await tx
    .select({ id: trips.id, startOn: trips.startOn })
    .from(trips)
    .where(gte(trips.startOn, today));
  const horizon = `${addMonths(month, 12)}-01`;
  const confirmedNext12 = future.filter((trip) => trip.startOn < horizon).length;

  const finish = async (
    budgetMonthly: string,
    items: TripSuggestion[],
    text: ViagensReportInput,
    suggestions: number,
  ) => {
    const data: ReportViagens = { budgetMonthly, suggestions: items, confirmedNext12 };
    const report = { ...viagensReportText(text), data };
    await saveDailyReport(tx, householdId, VIAGENS_AGENT, "viagens", today, report);
    return { suggestions, applied: 0, report };
  };

  if (tripsPerYear <= 0) {
    return finish("0.00", [], { day: today, kind: "sem_pedido" }, 0);
  }
  const allocation = await resolveAllocation(tx, input);
  if (!allocation) {
    return finish("0.00", [], { day: today, kind: "sem_divisao" }, 0);
  }

  const [year, monthNumber] = today.split("-").map(Number) as [number, number];
  const personRows = await tx.select().from(people);
  const travelers: TripTraveler[] = personRows
    .filter((person) => ["titular", "conjuge", "filho"].includes(person.relation))
    .map((person) => ({
      personId: person.id,
      ageYears:
        person.birthYear !== null
          ? ageFromBirth(person.birthYear, person.birthMonth ?? 1, { year, month: monthNumber })
          : null,
    }));
  if (travelers.length === 0) {
    return finish(allocation.tripsBudget, [], { day: today, kind: "sem_pessoas" }, 0);
  }

  const items = suggestTrips({
    today,
    tripsPerYear,
    tripDays: settings?.tripDays ?? null,
    travelers,
    tripsBudgetMonthly: allocation.tripsBudget,
    destinations: await loadDestinations(tx),
    existingTripMonths: future.map((trip) => yearMonthOf(trip.startOn)),
    weddingMonth: settings?.weddingMonth ?? null,
  }).slice(0, tripsPerYear);

  // Sugestões de viagem são dado derivado: as pendentes que saíram da lista de hoje vão embora,
  // para nunca haver mais pendentes do que viagens por ano.
  const keys = items.map((item) => DEDUPE.viagem(item.destinationId, item.month.slice(0, 4)));
  await tx
    .delete(householdSuggestions)
    .where(
      and(
        eq(householdSuggestions.agent, VIAGENS_AGENT),
        eq(householdSuggestions.status, "pendente"),
        keys.length > 0 ? sql`not (${inArray(householdSuggestions.dedupeKey, keys)})` : sql`true`,
      ),
    );

  const pending: PendingSuggestion[] = items.map((item, index) => {
    const payload: ViagemPayload = {
      destinationId: item.destinationId,
      name: item.name,
      month: item.month,
      days: item.days,
      personIds: item.personIds,
      estimated: item.estimated,
      total: item.total,
      perPerson: item.perPerson,
      monthlyToSave: item.monthlyToSave,
      fits: item.fits,
      confidence: item.confidence,
      source: item.source,
    };
    return {
      kind: "viagem",
      ...viagemText(item, travelers.length),
      payload,
      dedupeKey: keys[index]!,
    };
  });
  const decisions = await loadDecisions(tx, today, VIAGENS_AGENT);
  const suggestions = await upsertPending(tx, householdId, VIAGENS_AGENT, decisions, pending);

  return finish(
    allocation.tripsBudget,
    items,
    {
      day: today,
      kind: "sugestoes",
      count: items.length,
      fits: items.filter((item) => item.fits).length,
      budget: allocation.tripsBudget,
      shortfall: money(allocation.shortfall).gt(0) ? allocation.shortfall : null,
    },
    suggestions,
  );
}
