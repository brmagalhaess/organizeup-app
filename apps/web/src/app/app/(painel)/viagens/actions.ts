"use server";
import { createTrip } from "@organizeup/agents";
import { getLocale, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  and,
  calendarEvents,
  canWrite,
  DESTINATION_REGIONS,
  eq,
  householdSuggestions,
  inArray,
  ne,
  people,
  sql,
  TRIP_COST_KINDS,
  tripCosts,
  tripDestinationTemplates,
  tripIntentions,
  tripPeople,
  trips,
  withHousehold,
  type TenantTx,
} from "@organizeup/db";
import { money, parseMoney, toDbAmount } from "@organizeup/domain";
import type { Locale } from "@/i18n/locales";
import { getBrazilRules } from "@/i18n/money-server";
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

/** Número opcional de um campo: vazio vira null. */
const optionalNumber = (min: number, max: number, message: string) =>
  z.string().transform((value, ctx) => {
    if (value.trim() === "") return null;
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= min && parsed <= max) return parsed;
    ctx.addIssue({ code: "custom", message });
    return z.NEVER;
  });

/** Texto livre vira uma linha só: a família escreve um lugar, não um parágrafo. */
const oneLine = (value: string) =>
  value
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const intentionSchema = (t: ErrorTexts) =>
  z
    .object({
      id: z.string(),
      destinationId: z.string().max(40),
      customName: z
        .string()
        .transform(oneLine)
        .pipe(z.string().max(80, t("intentionNameLong"))),
      customRegion: z.union([z.literal(""), z.enum(DESTINATION_REGIONS)], {
        message: t("intentionRegion"),
      }),
      preferredMonth: optionalNumber(1, 12, t("intentionMonth")),
      days: optionalNumber(1, 60, t("intentionDays")),
    })
    .superRefine((value, ctx) => {
      if (value.destinationId) return;
      if (!value.customName)
        ctx.addIssue({ code: "custom", message: t("intentionDestination"), path: ["customName"] });
      else if (!value.customRegion)
        ctx.addIssue({ code: "custom", message: t("intentionRegion"), path: ["customRegion"] });
    });

/**
 * A sugestão pendente foi feita com a intenção de antes. Sai junto: é dado derivado, e a próxima
 * rodada calcula de novo. Aceitar uma sugestão velha criaria a viagem errada.
 */
const dropPendingOf = (tx: TenantTx, intentionId: string) =>
  tx
    .delete(householdSuggestions)
    .where(
      and(
        eq(householdSuggestions.kind, "viagem"),
        eq(householdSuggestions.status, "pendente"),
        sql`${householdSuggestions.payload}->>'intentionId' = ${intentionId}`,
      ),
    );

/** Cria uma intenção ou edita a do `id`. Dado informado: só a família muda (regra 7). */
export async function saveIntention(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireModule("metas");
  if (!canWrite(ctx)) return blocked();
  const t = await getTranslations("viagens.errors");
  if (!(await getBrazilRules())) return { ok: false, message: t("intentionForeign") };
  const parsed = intentionSchema(t).safeParse({
    id: form.get("id") ?? "",
    destinationId: form.get("destinationId") ?? "",
    customName: form.get("customName") ?? "",
    customRegion: form.get("customRegion") ?? "",
    preferredMonth: form.get("preferredMonth") ?? "",
    days: form.get("days") ?? "",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t("check") };
  const { id, destinationId, customName, customRegion, preferredMonth, days } = parsed.data;
  const place = destinationId
    ? { destinationId, customName: null, customRegion: null }
    : { destinationId: null, customName, customRegion: customRegion || null };

  const failure = await withHousehold(ctx, async (tx) => {
    if (destinationId) {
      const [known] = await tx
        .select({ id: tripDestinationTemplates.id })
        .from(tripDestinationTemplates)
        .where(eq(tripDestinationTemplates.id, destinationId));
      if (!known) return t("intentionDestination");
    }
    const same = destinationId
      ? eq(tripIntentions.destinationId, destinationId)
      : sql`lower(trim(${tripIntentions.customName})) = lower(trim(${customName}))`;
    const [repeated] = await tx
      .select({ id: tripIntentions.id })
      .from(tripIntentions)
      .where(id ? and(same, ne(tripIntentions.id, id)) : same);
    if (repeated) return t("intentionRepeated");

    if (!id) {
      const [created] = await tx
        .insert(tripIntentions)
        .values({ householdId: ctx.householdId, ...place, preferredMonth, days })
        .onConflictDoNothing()
        .returning({ id: tripIntentions.id });
      if (!created) return t("intentionRepeated");
      await audit(tx, ctx, "create", "trip_intentions", created.id);
      return null;
    }
    const [updated] = await tx
      .update(tripIntentions)
      .set({ ...place, preferredMonth, days, updatedAt: new Date() })
      .where(eq(tripIntentions.id, id))
      .returning({ id: tripIntentions.id });
    if (!updated) return t("intentionNotFound");
    await dropPendingOf(tx, id);
    await audit(tx, ctx, "update", "trip_intentions", id);
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}

export async function deleteIntention(form: FormData): Promise<void> {
  const { ctx } = await requireModule("metas");
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    await dropPendingOf(tx, id);
    const removed = await tx
      .delete(tripIntentions)
      .where(eq(tripIntentions.id, id))
      .returning({ id: tripIntentions.id });
    if (removed.length > 0) await audit(tx, ctx, "delete", "trip_intentions", id);
  });
  revalidatePath("/app", "layout");
}

/** Refazer: a intenção atendida volta à fila do agente. A viagem criada continua onde está. */
export async function reopenIntention(form: FormData): Promise<void> {
  const { ctx } = await requireModule("metas");
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const reopened = await tx
      .update(tripIntentions)
      .set({ fulfilledAt: null, fulfilledTripId: null, updatedAt: new Date() })
      .where(eq(tripIntentions.id, id))
      .returning({ id: tripIntentions.id });
    if (reopened.length > 0) await audit(tx, ctx, "update", "trip_intentions", id);
  });
  revalidatePath("/app", "layout");
}
