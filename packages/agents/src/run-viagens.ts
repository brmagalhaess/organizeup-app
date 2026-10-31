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
  formatBRL,
  formatYearMonth,
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
  plural,
  resolveAllocation,
  saveDailyReport,
  upsertPending,
  type AgentInput,
  type AgentResult,
  type PendingSuggestion,
} from "./shared";

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

function suggestionText(item: TripSuggestion, travelers: number): { title: string; body: string } {
  const saveUntil = addMonths(item.month, -1);
  const parts = [
    `Em ${formatYearMonth(item.month)} · ${plural(item.days, "dia", "dias")} para ` +
      `${plural(travelers, "pessoa", "pessoas")}.`,
    `Cerca de ${formatBRL(item.total)} (${formatBRL(item.perPerson)} por pessoa): passagem ` +
      `${formatBRL(item.estimated.passagem)}, hospedagem ${formatBRL(item.estimated.hospedagem)}, ` +
      `alimentação ${formatBRL(item.estimated.alimentacao)} e transporte ` +
      `${formatBRL(item.estimated.transporte)}; passeios ficam por sua conta.`,
    item.fits
      ? `Guarde ${formatBRL(item.monthlyToSave)} por mês até ${formatYearMonth(saveUntil)}.`
      : `Pede ${formatBRL(item.monthlyToSave)} por mês, mais do que sobra para viagens hoje.`,
    item.note,
    `Valores aproximados pela nossa tabela de custos (confiança ${item.confidence}). Confira ` +
      `passagens e hospedagem antes de fechar. Fonte: ${item.source}`,
  ].filter(Boolean);
  return {
    title: `Que tal ${item.name} em ${formatYearMonth(item.month)}?`,
    body: parts.join(" "),
  };
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
    summary: string,
    suggestions: number,
  ) => {
    const data: ReportViagens = { budgetMonthly, suggestions: items, confirmedNext12 };
    const report = { title: `Viagens em ${today}`, summary, data };
    await saveDailyReport(tx, householdId, VIAGENS_AGENT, "viagens", today, report);
    return { suggestions, applied: 0, report };
  };

  if (tripsPerYear <= 0) {
    return finish(
      "0.00",
      [],
      "A família não pediu sugestões de viagem. Diga quantas viagens por ano em Configurações › Plano.",
      0,
    );
  }
  const allocation = await resolveAllocation(tx, input);
  if (!allocation) {
    return finish(
      "0.00",
      [],
      "Sem a divisão do que sobra hoje; as sugestões ficam para a próxima rodada.",
      0,
    );
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
    return finish(
      allocation.tripsBudget,
      [],
      "Cadastre as pessoas da família para receber sugestões de viagem.",
      0,
    );
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
      ...suggestionText(item, travelers.length),
      payload,
      dedupeKey: keys[index]!,
    };
  });
  const decisions = await loadDecisions(tx, today, VIAGENS_AGENT);
  const suggestions = await upsertPending(tx, householdId, VIAGENS_AGENT, decisions, pending);

  const fits = items.filter((item) => item.fits).length;
  const summary =
    items.length === 0
      ? `Nenhum destino da tabela cabe em ${formatBRL(allocation.tripsBudget)} por mês para viagens.`
      : `${plural(items.length, "viagem sugerida", "viagens sugeridas")} com ` +
        `${formatBRL(allocation.tripsBudget)} por mês para viagens` +
        (fits < items.length ? "; nem todas cabem no orçamento de hoje." : ".") +
        (money(allocation.shortfall).gt(0)
          ? ` As viagens já marcadas pedem ${formatBRL(allocation.shortfall)} a mais por mês.`
          : "");
  return finish(allocation.tripsBudget, items, summary, suggestions);
}
