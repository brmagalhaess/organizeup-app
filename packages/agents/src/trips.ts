// Criar uma viagem com o evento no calendário, as pessoas e os custos. Extraído de
// apps/web/src/app/app/(painel)/viagens/actions.ts para a web e o `applySuggestion` usarem o mesmo
// caminho. Rode dentro de withHousehold; o chamador já validou os campos.
import {
  calendarEvents,
  inArray,
  people,
  tripCosts,
  tripPeople,
  trips,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import { money } from "@organizeup/domain";
import { recordAudit } from "./shared";

export type TripCostKind =
  "passagem" | "hospedagem" | "alimentacao" | "transporte" | "passeios" | "outros";

export interface CreateTripInput {
  destination: string;
  /** AAAA-MM-DD. */
  startOn: string;
  endOn: string | null;
  personIds: string[];
  /** Custos iniciais; valores zerados são ignorados (a coluna exige > 0). */
  costs: Array<{ kind: TripCostKind; amount: string; perPerson: boolean }>;
}

/**
 * Cria a viagem, o evento "Viagem: <destino>" na data de ida, quem vai e os custos. Lança
 * `Error("Escolha pessoas da família.")` se algum id não for desta família.
 */
export async function createTrip(
  tx: TenantTx,
  ctx: TenantContext,
  input: CreateTripInput,
): Promise<{ tripId: string; eventId: string }> {
  const personIds = [...new Set(input.personIds)];
  if (personIds.length === 0) throw new Error("Escolha quem vai.");
  const known = await tx
    .select({ id: people.id })
    .from(people)
    .where(inArray(people.id, personIds));
  if (known.length !== personIds.length) throw new Error("Escolha pessoas da família.");

  const title = `Viagem: ${input.destination}`;
  const [event] = await tx
    .insert(calendarEvents)
    .values({
      householdId: ctx.householdId,
      title,
      eventDate: input.startOn,
      createdBy: ctx.userId,
    })
    .returning({ id: calendarEvents.id });
  const [created] = await tx
    .insert(trips)
    .values({
      householdId: ctx.householdId,
      destination: input.destination,
      startOn: input.startOn,
      endOn: input.endOn,
      calendarEventId: event!.id,
    })
    .returning({ id: trips.id });
  const tripId = created!.id;
  await tx
    .insert(tripPeople)
    .values(personIds.map((personId) => ({ householdId: ctx.householdId, tripId, personId })));
  const costs = input.costs.filter((cost) => money(cost.amount).gt(0));
  if (costs.length > 0) {
    await tx.insert(tripCosts).values(
      costs.map((cost) => ({
        householdId: ctx.householdId,
        tripId,
        kind: cost.kind,
        amount: cost.amount,
        perPerson: cost.perPerson,
      })),
    );
  }
  await recordAudit(tx, ctx, "create", "trips", tripId);
  return { tripId, eventId: event!.id };
}
