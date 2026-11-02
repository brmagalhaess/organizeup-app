"use server";
import { createTrip } from "@organizeup/agents";
import { getLocale, getTranslations } from "next-intl/server";
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
import { money, parseMoney, toDbAmount } from "@organizeup/domain";
import type { Locale } from "@/i18n/locales";
import { audit } from "@/lib/audit";
import { requireModule } from "@/lib/billing/plan-gate";

export interface FormState {
  ok: boolean;
  message: string | null;
}

const blocked = async (): Promise<FormState> => ({
  ok: false,
  message: (await getTranslations("settings"))("noPermission"),
});

const reais = (message: string, locale: Locale) =>
  z.string().transform((value, ctx) => {
    try {
      const parsed = parseMoney(value, locale);
      if (parsed.lte(0) || parsed.gte("1000000000000")) throw new RangeError("fora do limite");
      return toDbAmount(parsed);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });

type ErrorTexts = Awaited<ReturnType<typeof getTranslations<"viagens.errors">>>;

const dateSchema = (t: ErrorTexts) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, t("date"))
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), t("invalidDate"));

const tripSchema = (t: ErrorTexts) =>
  z
    .object({
      id: z.string(),
      destination: z.string().trim().min(1, t("destination")).max(80),
      startOn: dateSchema(t),
      endOn: z.union([z.literal(""), dateSchema(t)]).transform((value) => value || null),
      personIds: z.array(z.string()).min(1, t("who")),
    })
    .refine((v) => v.endOn === null || v.endOn >= v.startOn, {
      message: t("returnBeforeStart"),
    });

/** Erros de validação do `createTrip`, que chegam em português, e a chave de cada um. */
const TRIP_ERRORS = new Map<string, "who" | "familyPeople">([
  ["Escolha quem vai.", "who"],
  ["Escolha pessoas da família.", "familyPeople"],
]);

/** Cria uma viagem ou edita a do `id`. A data vai junto para o calendário. */
export async function saveTrip(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireModule("metas");
  if (!canWrite(ctx)) return blocked();
  const t = await getTranslations("viagens.errors");
  const parsed = tripSchema(t).safeParse({
    id: form.get("id") ?? "",
    destination: form.get("destination") ?? "",
    startOn: form.get("startOn") ?? "",
    endOn: form.get("endOn") ?? "",
    personIds: form.getAll("personId").map(String),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t("check") };
  const { id, destination, startOn, endOn, personIds } = parsed.data;
  const title = `Viagem: ${destination}`;

  const failure = await withHousehold(ctx, async (tx) => {
    if (!id) {
      try {
        await createTrip(tx, ctx, { destination, startOn, endOn, personIds, costs: [] });
        return null;
      } catch (error) {
        // Erro de banco nunca vira texto de tela: pode carregar dados da consulta.
        const key = error instanceof Error ? TRIP_ERRORS.get(error.message) : undefined;
        if (key) return t(key);
        throw error;
      }
    }

    const known = await tx
      .select({ id: people.id })
      .from(people)
      .where(inArray(people.id, personIds));
    if (known.length !== personIds.length) return t("familyPeople");
    const [trip] = await tx
      .update(trips)
      .set({ destination, startOn, endOn })
      .where(eq(trips.id, id))
      .returning({ calendarEventId: trips.calendarEventId });
    if (!trip) return t("notFound");
    if (trip.calendarEventId) {
      await tx
        .update(calendarEvents)
        .set({ title, eventDate: startOn })
        .where(eq(calendarEvents.id, trip.calendarEventId));
    }
    await tx.delete(tripPeople).where(eq(tripPeople.tripId, id));
    await audit(tx, ctx, "update", "trips", id);
    await tx
      .insert(tripPeople)
      .values(
        personIds.map((personId) => ({ householdId: ctx.householdId, tripId: id, personId })),
      );
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}

export async function deleteTrip(form: FormData): Promise<void> {
  const { ctx } = await requireModule("metas");
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

const costSchema = (t: ErrorTexts, locale: Locale) =>
  z.object({
    tripId: z.string().min(1),
    kind: z.enum(TRIP_COST_KINDS, { message: t("costKind") }),
    amount: reais(t("costAmount"), locale),
    perPerson: z.boolean(),
  });

export async function addCost(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireModule("metas");
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await Promise.all([getTranslations("viagens.errors"), getLocale()]);
  const parsed = costSchema(t, locale).safeParse({
    tripId: form.get("tripId") ?? "",
    kind: form.get("kind"),
    amount: form.get("amount") ?? "",
    perPerson: form.get("perPerson") === "on",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t("check") };
  const failure = await withHousehold(ctx, async (tx) => {
    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.id, parsed.data.tripId));
    if (!trip) return t("notFound");
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
  const { ctx } = await requireModule("metas");
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
  const { ctx } = await requireModule("metas");
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await Promise.all([getTranslations("viagens.errors"), getLocale()]);
  const id = String(form.get("id") ?? "");
  const amount = reais(t("savedAmount"), locale).safeParse(form.get("amount") ?? "");
  if (!amount.success) return { ok: false, message: amount.error.issues[0]?.message ?? t("check") };
  const failure = await withHousehold(ctx, async (tx) => {
    const [trip] = await tx.select({ saved: trips.saved }).from(trips).where(eq(trips.id, id));
    if (!trip) return t("notFound");
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
