// Agente diário de viagens (ADR-0015). Com `trips_per_year > 0`, sugere destinos que cabem no
// orçamento de viagens da divisão do dia, com as intenções da família na frente (ADR-0026). Só sugere:
// nada entra no calendário sem a família aceitar, e a intenção nunca é alterada aqui.
import {
  and,
  asc,
  eq,
  gte,
  householdCurrency,
  householdSettings,
  householdSuggestions,
  inArray,
  like,
  ne,
  people,
  sql,
  tolerateSchemaLag,
  tripDestinationTemplates,
  tripIntentions,
  trips,
  type TenantTx,
} from "@organizeup/db";
import {
  addMonths,
  ageFromBirth,
  brazilRulesApply,
  money,
  normalizePlace,
  planTrips,
  yearMonthOf,
  type DestinationTemplate,
  type IntentionOutcome,
  type TripIntention,
  type TripSuggestion,
  type TripTraveler,
} from "@organizeup/domain";
import type { ReportViagens } from "./reports";
import { DEDUPE, INTENTION_DEDUPE_PREFIX, type ViagemPayload } from "./suggestions";
import {
  loadDecisions,
  shiftDays,
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

export type TripIntentionRow = typeof tripIntentions.$inferSelect;

/** Intenções, das mais antigas para as novas. Banco atrasado: nenhuma, sem derrubar a transação. */
export const loadTripIntentions = (tx: TenantTx): Promise<TripIntentionRow[]> =>
  tolerateSchemaLag(
    () =>
      tx.transaction((step) =>
        step
          .select()
          .from(tripIntentions)
          .orderBy(asc(tripIntentions.createdAt), asc(tripIntentions.id)),
      ),
    [],
  );

export interface IntentionDecisions {
  /** Por intenção, o ano da viagem recusada ou desfeita mais adiante. */
  refused: Map<string, number>;
  /** Anos civis em que saiu sugestão de intenção que a família já decidiu. */
  decidedIn: Set<number>;
}

const INTENTION_KEY = new RegExp(`^${INTENTION_DEDUPE_PREFIX}(.+):(\\d{4})$`);

/** O que a família decidiu sobre as sugestões de intenção. Recusa não expira em 30 dias: vale o ano. */
export async function loadIntentionDecisions(tx: TenantTx): Promise<IntentionDecisions> {
  const rows = await tx
    .select({
      dedupeKey: householdSuggestions.dedupeKey,
      status: householdSuggestions.status,
      createdAt: householdSuggestions.createdAt,
    })
    .from(householdSuggestions)
    .where(
      and(
        eq(householdSuggestions.agent, VIAGENS_AGENT),
        like(householdSuggestions.dedupeKey, `${INTENTION_DEDUPE_PREFIX}%`),
        ne(householdSuggestions.status, "pendente"),
      ),
    );
  const refused = new Map<string, number>();
  const decidedIn = new Set<number>();
  for (const row of rows) {
    decidedIn.add(row.createdAt.getUTCFullYear());
    const match = INTENTION_KEY.exec(row.dedupeKey);
    if (!match || row.status === "aplicada") continue;
    const [, id, year] = match as unknown as [string, string, string];
    refused.set(id, Math.max(refused.get(id) ?? 0, Number(year)));
  }
  return { refused, decidedIn };
}

/** Por quanto tempo um destino do catálogo recusado fica de fora. */
export const TRIP_REFUSAL_DAYS = 365;

/**
 * Destinos do catálogo que a família recusou no último ano, desfez em qualquer data, ou aceitou e depois
 * apagou a viagem na tela (no último ano). Vale o destino, não a chave: a chave leva o ano do mês
 * sugerido, e o mês muda de ano quando outra viagem ocupa o lugar.
 */
export async function loadRefusedDestinations(tx: TenantTx, today: string): Promise<string[]> {
  const since = new Date(`${shiftDays(today, -TRIP_REFUSAL_DAYS)}T00:00:00Z`);
  const rows = await tx
    .select({
      status: householdSuggestions.status,
      decidedAt: householdSuggestions.decidedAt,
      payload: householdSuggestions.payload,
    })
    .from(householdSuggestions)
    .where(
      and(
        eq(householdSuggestions.agent, VIAGENS_AGENT),
        eq(householdSuggestions.kind, "viagem"),
        inArray(householdSuggestions.status, ["ignorada", "desfeita", "aplicada"]),
        sql`not (${like(householdSuggestions.dedupeKey, `${INTENTION_DEDUPE_PREFIX}%`)})`,
      ),
    );
  const accepted = rows.filter((row) => row.status === "aplicada");
  const tripIds = accepted.flatMap((row) =>
    typeof row.payload.tripId === "string" ? [row.payload.tripId] : [],
  );
  const kept =
    tripIds.length > 0
      ? new Set(
          (await tx.select({ id: trips.id }).from(trips).where(inArray(trips.id, tripIds))).map(
            (row) => row.id,
          ),
        )
      : new Set<string>();
  const refused = new Set<string>();
  for (const row of rows) {
    const id = row.payload.destinationId;
    if (typeof id !== "string") continue;
    const recent = row.decidedAt !== null && row.decidedAt >= since;
    if (row.status === "desfeita") refused.add(id);
    else if (row.status === "ignorada" && recent) refused.add(id);
    // Aceita e apagada na tela: a família não quis a viagem, mesmo sem usar Desfazer.
    else if (
      row.status === "aplicada" &&
      recent &&
      typeof row.payload.tripId === "string" &&
      !kept.has(row.payload.tripId)
    ) {
      refused.add(id);
    }
  }
  return [...refused];
}

const toIntention = (row: TripIntentionRow, decisions: IntentionDecisions): TripIntention => ({
  id: row.id,
  destinationId: row.destinationId,
  customName: row.customName,
  customRegion: row.customRegion,
  preferredMonth: row.preferredMonth,
  days: row.days,
  fulfilled: row.fulfilledAt !== null,
  refusedYear: decisions.refused.get(row.id) ?? null,
});

export type ViagensResult = AgentResult & {
  /** Contagens para o `ops`: quantas famílias têm intenção e quantas viraram sugestão hoje. */
  intentions: { total: number; used: number };
};

export async function runViagensAgent(tx: TenantTx, input: AgentInput): Promise<ViagensResult> {
  const { today, householdId } = input;
  const month = yearMonthOf(today);
  const [settings] = await tx.select().from(householdSettings);
  const tripsPerYear = settings?.tripsPerYear ?? 0;

  const future = await tx
    .select({ id: trips.id, startOn: trips.startOn, destination: trips.destination })
    .from(trips)
    .where(gte(trips.startOn, today));
  const horizon = `${addMonths(month, 12)}-01`;
  const confirmedNext12 = future.filter((trip) => trip.startOn < horizon).length;

  const currentYear = Number(today.slice(0, 4));
  const intentionRows = await loadTripIntentions(tx);
  const intentionDecisions: IntentionDecisions =
    intentionRows.length > 0
      ? await loadIntentionDecisions(tx)
      : { refused: new Map(), decidedIn: new Set() };
  const intentions = intentionRows.map((row) => toIntention(row, intentionDecisions));
  const open = intentions.filter(
    (item) => !item.fulfilled && (item.refusedYear ?? 0) < currentYear,
  );

  const finish = async (
    budgetMonthly: string,
    items: TripSuggestion[],
    text: ViagensReportInput,
    suggestions: number,
    outcomes: IntentionOutcome[] = [],
  ) => {
    const used = outcomes.filter((outcome) => outcome.status === "sugerida").length;
    const versions = new Map(intentionRows.map((row) => [row.id, row.updatedAt.toISOString()]));
    const data: ReportViagens = {
      budgetMonthly,
      suggestions: items,
      confirmedNext12,
      ...(intentionRows.length > 0
        ? {
            intentions: {
              total: intentionRows.length,
              used,
              outcomes: outcomes.map((outcome) => ({
                ...outcome,
                updatedAt: versions.get(outcome.intentionId)!,
              })),
            },
          }
        : {}),
    };
    const report = { ...viagensReportText(text), data };
    await saveDailyReport(tx, householdId, VIAGENS_AGENT, "viagens", today, report);
    return { suggestions, applied: 0, report, intentions: { total: intentionRows.length, used } };
  };

  // A tabela de destinos está em reais, para quem sai do Brasil.
  const currency = await householdCurrency(tx);
  if (!brazilRulesApply(currency)) {
    return finish("0.00", [], { day: today, kind: "fora_do_brasil" }, 0);
  }
  // Quem pediu zero viagens não recebe catálogo, mas a intenção cadastrada não fica ignorada.
  if (tripsPerYear <= 0 && open.length === 0) {
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

  const destinations = await loadDestinations(tx);
  const savedPlaces = new Set(future.map((trip) => normalizePlace(trip.destination)));
  const savedDestinationIds = destinations
    .filter((destination) => savedPlaces.has(normalizePlace(destination.name)))
    .map((destination) => destination.id);
  const plan = planTrips({
    today,
    tripsPerYear,
    tripDays: settings?.tripDays ?? null,
    travelers,
    tripsBudgetMonthly: allocation.tripsBudget,
    destinations,
    existingTripMonths: future.map((trip) => yearMonthOf(trip.startOn)),
    weddingMonth: settings?.weddingMonth ?? null,
    currency,
    intentions,
    intentionUsedThisYear: intentionDecisions.decidedIn.has(currentYear),
    savedDestinationIds,
    refusedDestinationIds: await loadRefusedDestinations(tx, today),
  });
  const items = plan.suggestions;

  // Sugestões de viagem são dado derivado: as pendentes que saíram da lista de hoje vão embora,
  // para nunca haver mais pendentes do que viagens por ano.
  const keys = items.map((item) => {
    const year = item.month.slice(0, 4);
    return item.intentionId
      ? DEDUPE.viagemIntencao(item.intentionId, year)
      : DEDUPE.viagem(item.destinationId, year);
  });
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
      ...(item.intentionId ? { intentionId: item.intentionId } : {}),
      ...(item.regionEstimate ? { regionEstimate: item.regionEstimate } : {}),
      ...(item.postponed ? { postponed: item.postponed } : {}),
    };
    return {
      kind: "viagem",
      ...viagemText(item, travelers.length, currency),
      payload,
      dedupeKey: keys[index]!,
    };
  });
  const decisions = await loadDecisions(tx, today, VIAGENS_AGENT);
  const suggestions = await upsertPending(tx, householdId, VIAGENS_AGENT, decisions, pending);

  const used = items.filter((item) => item.intentionId).length;
  return finish(
    allocation.tripsBudget,
    items,
    tripsPerYear <= 0 && items.length === 0
      ? { day: today, kind: "sem_pedido" }
      : {
          day: today,
          kind: "sugestoes",
          count: items.length,
          fits: items.filter((item) => item.fits).length,
          budget: allocation.tripsBudget,
          shortfall: money(allocation.shortfall).gt(0) ? allocation.shortfall : null,
          currency,
          ...(used > 0 ? { intentions: used } : {}),
        },
    suggestions,
    plan.intentions,
  );
}
