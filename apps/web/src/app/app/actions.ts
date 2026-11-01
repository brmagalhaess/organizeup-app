"use server";
import { getLocale, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  and,
  eq,
  isNull,
  ne,
  auditLog,
  canWrite,
  householdSettings,
  people,
  PERSON_RELATIONS,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import { isValidTimezone } from "@organizeup/domain";
import {
  adultProfileShapeIn,
  birthField,
  birthParts,
  isPlanAdult,
  NO_SUCH_DAY,
  optionalInt,
  patchSettings,
  planShape,
  saveWedding,
  weddingSchema,
} from "@/lib/onboarding";
import type { Locale } from "@/i18n/locales";
import { requireTenant } from "@/lib/session";

export interface ActionState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
}

function audit(
  tx: TenantTx,
  ctx: TenantContext,
  action: string,
  entity: string,
  entityId?: string,
) {
  return tx.insert(auditLog).values({
    householdId: ctx.householdId,
    actorUserId: ctx.userId,
    actorKind: "user",
    action,
    entity,
    entityId: entityId ?? null,
  });
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

/** Mesmas validações de quem usa o texto em português, com a mensagem no idioma da pessoa. */
function translated(error: z.ZodError, texts: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(fieldErrors(error)).map(([field, text]) => [field, texts[field] ?? text]),
  );
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const settingsSchema = z.object({
  city: optionalText(80),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || /^[A-Z]{2}$/.test(v), "Use a sigla do estado (ex.: SP)."),
  timezone: z.string().trim().refine(isValidTimezone, "Fuso horário inválido."),
});

/**
 * Prepara um household recém-criado: configurações + pessoa titular (o próprio usuário).
 * Idempotente.
 */
export async function bootstrapHousehold(input: {
  city?: string;
  state?: string;
}): Promise<ActionState> {
  const { session, ctx } = await requireTenant();
  if (ctx.role !== "owner") return { ok: false, message: "Somente o responsável pode configurar." };
  const parsed = settingsSchema.safeParse({
    city: input.city ?? "",
    state: input.state ?? "",
    timezone: "America/Sao_Paulo",
  });
  if (!parsed.success)
    return { ok: false, message: "Dados inválidos.", fieldErrors: fieldErrors(parsed.error) };

  await withHousehold(ctx, async (tx) => {
    await tx
      .insert(householdSettings)
      .values({ householdId: ctx.householdId, ...parsed.data })
      .onConflictDoNothing();
    const existing = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.userId, session.user.id))
      .limit(1);
    if (existing.length === 0) {
      const [person] = await tx
        .insert(people)
        .values({
          householdId: ctx.householdId,
          name: session.user.name,
          relation: "titular",
          userId: session.user.id,
        })
        .returning({ id: people.id });
      await tx
        .update(householdSettings)
        .set({ primaryPersonId: person!.id })
        .where(
          and(
            eq(householdSettings.householdId, ctx.householdId),
            isNull(householdSettings.primaryPersonId),
          ),
        );
      await audit(tx, ctx, "create", "people", person!.id);
    }
    await audit(tx, ctx, "bootstrap", "household", ctx.householdId);
  });
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}

type PersonTexts = Awaited<ReturnType<typeof getTranslations<"pessoas">>>;

const personSchema = (t: PersonTexts, locale: Locale) =>
  z.object({
    name: z.string().trim().min(1, t("errors.name")).max(120),
    relation: z.enum(PERSON_RELATIONS, { message: t("errors.relation") }),
    birth: birthField,
    ...adultProfileShapeIn(locale),
    retirementAge: optionalInt(40, 100, t("errors.retirementAge")),
  });

/** `birth` e o perfil do adulto vêm de @/lib/onboarding, com o texto de /app/completar. */
const personFieldErrors = (error: z.ZodError, t: PersonTexts) =>
  translated(error, {
    birth: t("errors.birth"),
    workStatus: t("errors.workStatus"),
    inssContributor: t("errors.inss"),
    expectedPension: t("errors.pension"),
  });

function readPerson(formData: FormData, t: PersonTexts, locale: Locale) {
  const text = (name: string) => String(formData.get(name) ?? "");
  return personSchema(t, locale).safeParse({
    name: text("name"),
    relation: text("relation"),
    birth: text("birth"),
    workStatus: text("workStatus"),
    inssContributor: text("inssContributor"),
    expectedPension: text("expectedPension"),
    retirementAge: text("retirementAge"),
  });
}

/** Colunas da pessoa. Quem não entra no plano fica sem dados de trabalho e previdência. */
function personValues(data: z.output<ReturnType<typeof personSchema>>, relation: string) {
  const adult = isPlanAdult(relation);
  return {
    name: data.name,
    ...birthParts(data.birth),
    workStatus: adult ? data.workStatus : null,
    inssContributor: adult ? data.inssContributor : null,
    expectedPension: adult ? data.expectedPension : null,
    retirementAge: adult ? data.retirementAge : null,
  };
}

export async function addPerson(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx } = await requireTenant();
  const [t, tSettings, locale] = await Promise.all([
    getTranslations("pessoas"),
    getTranslations("settings"),
    getLocale(),
  ]);
  if (!canWrite(ctx)) return { ok: false, message: tSettings("noPermission") };
  const parsed = readPerson(formData, t, locale);
  if (!parsed.success)
    return { ok: false, message: null, fieldErrors: personFieldErrors(parsed.error, t) };
  const { relation } = parsed.data;
  if (relation === "titular")
    return { ok: false, message: null, fieldErrors: { relation: t("errors.relation") } };

  await withHousehold(ctx, async (tx) => {
    const [person] = await tx
      .insert(people)
      .values({ householdId: ctx.householdId, relation, ...personValues(parsed.data, relation) })
      .returning({ id: people.id });
    await audit(tx, ctx, "create", "people", person!.id);
  });
  revalidatePath("/app", "layout");
  return { ok: true, message: t("saved.added") };
}

/** Edita uma pessoa. O titular continua titular e ninguém vira titular por aqui. */
export async function updatePerson(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx } = await requireTenant();
  const [t, tSettings, locale] = await Promise.all([
    getTranslations("pessoas"),
    getTranslations("settings"),
    getLocale(),
  ]);
  if (!canWrite(ctx)) return { ok: false, message: tSettings("noPermission") };
  const id = String(formData.get("id") ?? "");
  const parsed = readPerson(formData, t, locale);
  if (!parsed.success)
    return { ok: false, message: null, fieldErrors: personFieldErrors(parsed.error, t) };

  const failure = await withHousehold(ctx, async (tx) => {
    const [current] = await tx
      .select({ relation: people.relation })
      .from(people)
      .where(eq(people.id, id));
    if (!current) return t("errors.personGone");
    const titular = current.relation === "titular";
    if (!titular && parsed.data.relation === "titular") return t("errors.relation");
    const relation = titular ? "titular" : parsed.data.relation;
    await tx
      .update(people)
      .set({ relation, ...personValues(parsed.data, relation), updatedAt: new Date() })
      .where(eq(people.id, id));
    await audit(tx, ctx, "update", "people", id);
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: t("saved.updated") };
}

/** Remove uma pessoa cadastrada. O titular não sai por aqui. */
export async function removePerson(formData: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(formData.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const removed = await tx
      .delete(people)
      .where(and(eq(people.id, id), ne(people.relation, "titular")))
      .returning({ id: people.id });
    if (removed.length > 0) await audit(tx, ctx, "delete", "people", id);
  });
  revalidatePath("/app", "layout");
}

export async function updateSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx } = await requireTenant();
  const t = await getTranslations("settings");
  if (!canWrite(ctx)) return { ok: false, message: t("noPermission") };
  const parsed = settingsSchema.safeParse({
    city: formData.get("city") ?? "",
    state: formData.get("state") ?? "",
    timezone: formData.get("timezone") ?? "",
  });
  if (!parsed.success) {
    const fieldErrors = translated(parsed.error, {
      state: t("home.stateError"),
      timezone: t("home.timezoneError"),
    });
    return { ok: false, message: null, fieldErrors };
  }

  await withHousehold(ctx, async (tx) => {
    await tx
      .insert(householdSettings)
      .values({ householdId: ctx.householdId, ...parsed.data })
      .onConflictDoUpdate({
        target: householdSettings.householdId,
        set: { ...parsed.data, updatedAt: new Date() },
      });
    await audit(tx, ctx, "update", "household_settings", ctx.householdId);
  });
  revalidatePath("/app", "layout");
  return { ok: true, message: t("home.saved") };
}

export async function updateWedding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx } = await requireTenant();
  const [t, tSettings] = await Promise.all([
    getTranslations("pessoas"),
    getTranslations("settings"),
  ]);
  if (!canWrite(ctx)) return { ok: false, message: tSettings("noPermission") };
  const parsed = weddingSchema.safeParse({
    weddingDay: String(formData.get("weddingDay") ?? ""),
    weddingMonth: String(formData.get("weddingMonth") ?? ""),
    weddingYear: String(formData.get("weddingYear") ?? ""),
  });
  if (!parsed.success) {
    const noSuchDay = parsed.error.issues.some((issue) => issue.message === NO_SUCH_DAY);
    const fieldErrors = translated(parsed.error, {
      weddingDay: t(noSuchDay ? "errors.noSuchDay" : "errors.weddingDay"),
      weddingMonth: t("errors.weddingMonth"),
      weddingYear: t("errors.weddingYear"),
    });
    return { ok: false, message: null, fieldErrors };
  }

  await withHousehold(ctx, async (tx) => {
    await saveWedding(tx, ctx, parsed.data);
    await audit(tx, ctx, "update", "household_settings", ctx.householdId);
  });
  revalidatePath("/app", "layout");
  return { ok: true, message: t("wedding.saved") };
}

const planSchema = z.object(planShape);

export async function updatePlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx } = await requireTenant();
  const t = await getTranslations("settings");
  if (!canWrite(ctx)) return { ok: false, message: t("noPermission") };
  const parsed = planSchema.safeParse({
    retirementYear: String(formData.get("retirementYear") ?? ""),
    tripsPerYear: String(formData.get("tripsPerYear") ?? ""),
    tripDays: String(formData.get("tripDays") ?? ""),
  });
  if (!parsed.success) {
    const fieldErrors = translated(parsed.error, {
      retirementYear: t("plan.retirementYearError"),
      tripsPerYear: t("plan.tripsPerYearError"),
      tripDays: t("plan.tripDaysError"),
    });
    return { ok: false, message: null, fieldErrors };
  }

  await withHousehold(ctx, async (tx) => {
    await patchSettings(tx, ctx, {
      retirementYear: parsed.data.retirementYear,
      tripsPerYear: parsed.data.tripsPerYear ?? 0,
      tripDays: parsed.data.tripDays,
    });
    await audit(tx, ctx, "update", "household_settings", ctx.householdId);
  });
  revalidatePath("/app", "layout");
  return { ok: true, message: t("plan.saved") };
}
