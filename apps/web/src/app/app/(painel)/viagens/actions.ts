"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  calendarEvents,
  canWrite,
  eq,
  inArray,
  people,
  TRIP_COST_KINDS,
  tripCosts,
  tripPeople,
  trips,
  withHousehold,
} from "@organizeup/db";
import { money, parseBRL, toDbAmount } from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface FormState {
  ok: boolean;
  message: string | null;
}

const blocked: FormState = {
  ok: false,
  message: "Seu papel nesta família não permite alterações.",
};

const reais = (message: string) =>
  z.string().transform((value, ctx) => {
    try {
      const parsed = parseBRL(value);
      if (parsed.lte(0) || parsed.gte("1000000000000")) throw new RangeError("fora do limite");
      return toDbAmount(parsed);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data.")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Data inválida.");

const tripSchema = z
  .object({
    id: z.string(),
    destination: z.string().trim().min(1, "Informe o destino.").max(80),
    startOn: dateSchema,
    endOn: z.union([z.literal(""), dateSchema]).transform((value) => value || null),
    personIds: z.array(z.string()).min(1, "Escolha quem vai."),
  })
  .refine((v) => v.endOn === null || v.endOn >= v.startOn, {
    message: "A volta não pode ser antes da ida.",
  });

/** Cria uma viagem ou edita a do `id`. A data vai junto para o calendário. */
export async function saveTrip(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked;
  const parsed = tripSchema.safeParse({
    id: form.get("id") ?? "",
    destination: form.get("destination") ?? "",
    startOn: form.get("startOn") ?? "",
    endOn: form.get("endOn") ?? "",
    personIds: form.getAll("personId").map(String),
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };
  const { id, destination, startOn, endOn, personIds } = parsed.data;
  const title = `Viagem: ${destination}`;

  const failure = await withHousehold(ctx, async (tx) => {
    const known = await tx
      .select({ id: people.id })
      .from(people)
      .where(inArray(people.id, personIds));
    if (known.length !== personIds.length) return "Escolha pessoas da família.";

    let tripId = id;
    if (id) {
      const [trip] = await tx
        .update(trips)
        .set({ destination, startOn, endOn })
        .where(eq(trips.id, id))
        .returning({ calendarEventId: trips.calendarEventId });
      if (!trip) return "Viagem não encontrada.";
      if (trip.calendarEventId) {
        await tx
          .update(calendarEvents)
          .set({ title, eventDate: startOn })
          .where(eq(calendarEvents.id, trip.calendarEventId));
      }
      await tx.delete(tripPeople).where(eq(tripPeople.tripId, id));
      await audit(tx, ctx, "update", "trips", id);
    } else {
      const [event] = await tx
        .insert(calendarEvents)
        .values({
          householdId: ctx.householdId,
          title,
          eventDate: startOn,
          createdBy: ctx.userId,
        })
        .returning({ id: calendarEvents.id });
      const [created] = await tx
        .insert(trips)
        .values({
          householdId: ctx.householdId,
          destination,
          startOn,
          endOn,
          calendarEventId: event!.id,
        })
        .returning({ id: trips.id });
      tripId = created!.id;
      await audit(tx, ctx, "create", "trips", tripId);
    }
    await tx
      .insert(tripPeople)
      .values(personIds.map((personId) => ({ householdId: ctx.householdId, tripId, personId })));
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}

export async function deleteTrip(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const [removed] = await tx
      .delete(trips)
      .where(eq(trips.id, id))
      .returning({ calendarEventId: trips.calendarEventId });
    if (!removed) return;
    if (removed.calendarEventId) {
      await tx.delete(calendarEvents).where(eq(calendarEvents.id, removed.calendarEventId));
    }
    await audit(tx, ctx, "delete", "trips", id);
  });
  revalidatePath("/app", "layout");
}

const costSchema = z.object({
  tripId: z.string().min(1),
  kind: z.enum(TRIP_COST_KINDS, { message: "Escolha o tipo de custo." }),
  amount: reais("Informe o valor como 1.500,00."),
  perPerson: z.boolean(),
});

export async function addCost(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked;
  const parsed = costSchema.safeParse({
    tripId: form.get("tripId") ?? "",
    kind: form.get("kind"),
    amount: form.get("amount") ?? "",
    perPerson: form.get("perPerson") === "on",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };
  const failure = await withHousehold(ctx, async (tx) => {
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.id, parsed.data.tripId));
    if (!trip) return "Viagem não encontrada.";
    const [created] = await tx
      .insert(tripCosts)
      .values({ householdId: ctx.householdId, ...parsed.data })
      .returning({ id: tripCosts.id });
    await audit(tx, ctx, "create", "trip_costs", created!.id);
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}

export async function deleteCost(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const removed = await tx
      .delete(tripCosts)
      .where(eq(tripCosts.id, id))
      .returning({ id: tripCosts.id });
    if (removed.length > 0) await audit(tx, ctx, "delete", "trip_costs", id);
  });
  revalidatePath("/app", "layout");
}

/** Registra o que já foi separado. Não mexe em contas. */
export async function addSaved(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked;
  const id = String(form.get("id") ?? "");
  const amount = reais("Informe o valor como 500,00.").safeParse(form.get("amount") ?? "");
  if (!amount.success)
    return { ok: false, message: amount.error.issues[0]?.message ?? "Verifique." };
  const failure = await withHousehold(ctx, async (tx) => {
    const [trip] = await tx.select({ saved: trips.saved }).from(trips).where(eq(trips.id, id));
    if (!trip) return "Viagem não encontrada.";
    await tx
      .update(trips)
      .set({ saved: toDbAmount(money(trip.saved).plus(amount.data)) })
      .where(eq(trips.id, id));
    await audit(tx, ctx, "update", "trips", id);
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}
