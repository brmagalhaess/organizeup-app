"use server";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  accounts,
  and,
  canWrite,
  eq,
  GOAL_KINDS,
  goals,
  inArray,
  people,
  PERSON_RELATIONS,
  readFamilyAccess,
  retirementPlan,
  withHousehold,
} from "@organizeup/db";
import { canUse, isYearMonth } from "@organizeup/domain";
import { knownText } from "@/i18n/known-text";
import { audit } from "@/lib/audit";
import {
  adultProfileFor,
  birthField,
  birthParts,
  markOnboardingDone,
  optionalAmount,
  patchSettings,
  planShape,
  saveWedding,
  weddingSchema,
} from "@/lib/onboarding";
import { requireTenant } from "@/lib/session";
import ptBR from "../../../../../messages/pt-BR.json";

export interface CompletarState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
}

const blocked = async (): Promise<CompletarState> => ({
  ok: false,
  message: (await getTranslations("settings"))("noPermission"),
});

/** As validações são as mesmas de outras telas: o texto em português vira o do idioma da pessoa. */
async function errorTexts() {
  const { familiaOnboarding } = await getMessages();
  const translate = (text: string) =>
    knownText(text, ptBR.familiaOnboarding.errors, familiaOnboarding.errors);
  return (error: z.ZodError, suffix = ""): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const issue of error.issues) {
      const key = `${String(issue.path[0] ?? "form")}${suffix}`;
      out[key] ??= translate(issue.message);
    }
    return out;
  };
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

function nextStep(step: number): never {
  revalidatePath("/app", "layout");
  redirect(`/app/completar?passo=${step}`);
}

const personSchema = z.object({
  personName: z.string().trim().min(1, "Informe o nome.").max(120),
  personRelation: z
    .enum(PERSON_RELATIONS, { message: "Escolha a relação." })
    .refine((relation) => relation !== "titular", "Escolha a relação."),
  personBirth: birthField,
});

/**
 * Passo 1. O botão "Adicionar pessoa" grava só a pessoa e fica no passo; "Continuar" grava o resto
 * e também a pessoa que ficou digitada, para ela não se perder.
 */
export async function saveFamilyStep(
  _prev: CompletarState,
  form: FormData,
): Promise<CompletarState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked();
  const fieldErrors = await errorTexts();
  const t = await getTranslations("familiaOnboarding");
  const onlyPerson = form.get("intent") === "person";
  const hasPerson = onlyPerson || text(form, "personName").trim() !== "";

  const person = hasPerson
    ? personSchema.safeParse({
        personName: text(form, "personName"),
        personRelation: text(form, "personRelation"),
        personBirth: text(form, "personBirth"),
      })
    : null;
  const birth = birthField.safeParse(text(form, "birth"));
  const wedding = weddingSchema.safeParse({
    weddingDay: text(form, "weddingDay"),
    weddingMonth: text(form, "weddingMonth"),
    weddingYear: text(form, "weddingYear"),
  });

  const errors: Record<string, string> = {
    ...(person && !person.success ? fieldErrors(person.error) : {}),
    ...(onlyPerson || wedding.success ? {} : fieldErrors(wedding.error)),
    ...(onlyPerson || birth.success ? {} : { birth: t("errors.monthYear") }),
  };
  if (Object.keys(errors).length > 0) return { ok: false, message: null, fieldErrors: errors };

  await withHousehold(ctx, async (tx) => {
    if (person?.success) {
      const [created] = await tx
        .insert(people)
        .values({
          householdId: ctx.householdId,
          name: person.data.personName,
          relation: person.data.personRelation,
          ...birthParts(person.data.personBirth),
        })
        .returning({ id: people.id });
      await audit(tx, ctx, "create", "people", created!.id);
    }
    if (onlyPerson) return;
    if (birth.data) {
      const updated = await tx
        .update(people)
        .set({ ...birthParts(birth.data), updatedAt: new Date() })
        .where(eq(people.relation, "titular"))
        .returning({ id: people.id });
      for (const row of updated) await audit(tx, ctx, "update", "people", row.id);
    }
    if (wedding.data) await saveWedding(tx, ctx, wedding.data);
    await audit(tx, ctx, "update", "household_settings", ctx.householdId);
  });

  if (onlyPerson) {
    revalidatePath("/app", "layout");
    return { ok: true, message: t("complete.personAdded") };
  }
  nextStep(2);
}

const retirementSchema = (locale: string) =>
  z.object({
    retirementYear: planShape.retirementYear,
    targetIncome: optionalAmount("Informe a renda como 6.000,00.", { positive: true }, locale),
    expectedYield: optionalAmount(
      "Informe um percentual até 30, como 6 ou 6,5.",
      { positive: true, max: "30" },
      locale,
    ),
  });
const adultSchema = (locale: string) => z.object(adultProfileFor(locale));

/** Passo 2: ano, renda e rendimento do plano e uma linha opcional por adulto. */
export async function saveRetirementStep(
  _prev: CompletarState,
  form: FormData,
): Promise<CompletarState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked();
  const fieldErrors = await errorTexts();
  const locale = await getLocale();
  const plan = retirementSchema(locale).safeParse({
    retirementYear: text(form, "retirementYear"),
    targetIncome: text(form, "targetIncome"),
    expectedYield: text(form, "expectedYield"),
  });
  const errors = plan.success ? {} : fieldErrors(plan.error);

  const adults: Array<{ id: string; data: z.output<ReturnType<typeof adultSchema>> }> = [];
  for (const id of form.getAll("adultId").map(String)) {
    const adult = adultSchema(locale).safeParse({
      workStatus: text(form, `workStatus:${id}`),
      inssContributor: text(form, `inssContributor:${id}`),
      expectedPension: text(form, `expectedPension:${id}`),
    });
    if (adult.success) adults.push({ id, data: adult.data });
    else Object.assign(errors, fieldErrors(adult.error, `:${id}`));
  }
  if (!plan.success || Object.keys(errors).length > 0)
    return { ok: false, message: null, fieldErrors: errors };

  const { retirementYear, targetIncome, expectedYield } = plan.data;
  // O cadastro não para quem não tem o módulo: só o plano de aposentadoria fica de fora.
  const withPlan = canUse(await readFamilyAccess(ctx), "aposentadoria");
  await withHousehold(ctx, async (tx) => {
    await patchSettings(tx, ctx, { retirementYear });
    if (withPlan) {
      await tx
        .insert(retirementPlan)
        .values({ householdId: ctx.householdId, targetIncome, expectedYield })
        .onConflictDoUpdate({
          target: retirementPlan.householdId,
          set: { targetIncome, expectedYield, updatedAt: new Date() },
        });
      await audit(tx, ctx, "update", "retirement_plan", ctx.householdId);
    }
    for (const { id, data } of adults) {
      const updated = await tx
        .update(people)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(people.id, id), inArray(people.relation, ["titular", "conjuge"])))
        .returning({ id: people.id });
      if (updated.length > 0) await audit(tx, ctx, "update", "people", id);
    }
  });
  nextStep(3);
}

const tripsSchema = z.object({
  tripsPerYear: planShape.tripsPerYear,
  tripDays: planShape.tripDays,
});

/** Passo 3: quantas viagens por ano e quantos dias costumam durar. */
export async function saveTripsStep(
  _prev: CompletarState,
  form: FormData,
): Promise<CompletarState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked();
  const fieldErrors = await errorTexts();
  const parsed = tripsSchema.safeParse({
    tripsPerYear: text(form, "tripsPerYear"),
    tripDays: text(form, "tripDays"),
  });
  if (!parsed.success) return { ok: false, message: null, fieldErrors: fieldErrors(parsed.error) };

  await withHousehold(ctx, async (tx) => {
    await patchSettings(tx, ctx, {
      tripsPerYear: parsed.data.tripsPerYear ?? 0,
      tripDays: parsed.data.tripDays,
    });
    await audit(tx, ctx, "update", "household_settings", ctx.householdId);
  });
  nextStep(4);
}

const goalSchema = (locale: string) =>
  z.object({
    goalName: z.string().trim().min(1, "Informe o nome da meta.").max(80),
    goalKind: z.enum(GOAL_KINDS, { message: "Escolha o tipo." }),
    goalAmount: optionalAmount(
      "Informe o valor como 80.000,00.",
      { positive: true },
      locale,
    ).refine((value) => value !== null, "Informe quanto custa."),
    goalMonth: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : value))
      .refine((value) => value === null || isYearMonth(value), "Use mês/ano válidos."),
    goalAccount: z.string().min(1, "Escolha a conta de onde sai."),
  });

/** Passo 4: cria a primeira meta, se a família preencheu, e encerra o cadastro. */
export async function finishOnboarding(
  _prev: CompletarState,
  form: FormData,
): Promise<CompletarState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked();
  const fieldErrors = await errorTexts();
  const [t, locale] = await Promise.all([getTranslations("familiaOnboarding"), getLocale()]);
  // Sem o módulo, o cadastro termina igual, sem criar a meta.
  const hasGoal =
    (text(form, "goalName").trim() !== "" || text(form, "goalAmount").trim() !== "") &&
    canUse(await readFamilyAccess(ctx), "metas");
  const goal = hasGoal
    ? goalSchema(locale).safeParse({
        goalName: text(form, "goalName"),
        goalKind: text(form, "goalKind"),
        goalAmount: text(form, "goalAmount"),
        goalMonth: text(form, "goalMonth"),
        goalAccount: text(form, "goalAccount"),
      })
    : null;
  if (goal && !goal.success)
    return { ok: false, message: null, fieldErrors: fieldErrors(goal.error) };

  const failure = await withHousehold(ctx, async (tx) => {
    if (goal?.data) {
      const { goalName, goalKind, goalAmount, goalMonth, goalAccount } = goal.data;
      const [account] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, goalAccount), eq(accounts.archived, false)));
      if (!account) return t("errors.goalAccount");
      const [created] = await tx
        .insert(goals)
        .values({
          householdId: ctx.householdId,
          name: goalName,
          kind: goalKind,
          targetAmount: goalAmount!,
          desiredMonth: goalMonth,
          accountId: account.id,
          createdBy: ctx.userId,
        })
        .returning({ id: goals.id });
      await audit(tx, ctx, "create", "goals", created!.id);
    }
    await markOnboardingDone(tx, ctx);
    return null;
  });
  if (failure) return { ok: false, message: null, fieldErrors: { goalAccount: failure } };

  revalidatePath("/app", "layout");
  redirect("/app");
}

/** "Não mostrar mais": a família dispensa o convite sem preencher nada. */
export async function skipOnboarding(_form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  await withHousehold(ctx, (tx) => markOnboardingDone(tx, ctx));
  revalidatePath("/app", "layout");
}
