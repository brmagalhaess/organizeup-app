"use server";
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
  retirementPlan,
  withHousehold,
} from "@organizeup/db";
import { isYearMonth } from "@organizeup/domain";
import { audit } from "@/lib/audit";
import {
  adultProfileShape,
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

export interface CompletarState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
}

const blocked: CompletarState = {
  ok: false,
  message: "Seu papel nesta família não permite alterações.",
};

function fieldErrors(error: z.ZodError, suffix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = `${String(issue.path[0] ?? "form")}${suffix}`;
    out[key] ??= issue.message;
  }
  return out;
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
  if (!canWrite(ctx)) return blocked;
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
    ...(onlyPerson || birth.success ? {} : { birth: "Use mês/ano válidos." }),
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
    return { ok: true, message: "Pessoa adicionada." };
  }
  nextStep(2);
}

const retirementSchema = z.object({
  retirementYear: planShape.retirementYear,
  targetIncome: optionalAmount("Informe a renda como 6.000,00.", { positive: true }),
  expectedYield: optionalAmount("Informe um percentual até 30, como 6 ou 6,5.", {
    positive: true,
    max: "30",
  }),
});
const adultSchema = z.object(adultProfileShape);

/** Passo 2: ano, renda e rendimento do plano e uma linha opcional por adulto. */
export async function saveRetirementStep(
  _prev: CompletarState,
  form: FormData,
): Promise<CompletarState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked;
  const plan = retirementSchema.safeParse({
    retirementYear: text(form, "retirementYear"),
    targetIncome: text(form, "targetIncome"),
    expectedYield: text(form, "expectedYield"),
  });
  const errors = plan.success ? {} : fieldErrors(plan.error);

  const adults: Array<{ id: string; data: z.output<typeof adultSchema> }> = [];
  for (const id of form.getAll("adultId").map(String)) {
    const adult = adultSchema.safeParse({
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
  await withHousehold(ctx, async (tx) => {
    await patchSettings(tx, ctx, { retirementYear });
    await tx
      .insert(retirementPlan)
      .values({ householdId: ctx.householdId, targetIncome, expectedYield })
      .onConflictDoUpdate({
        target: retirementPlan.householdId,
        set: { targetIncome, expectedYield, updatedAt: new Date() },
      });
    await audit(tx, ctx, "update", "retirement_plan", ctx.householdId);
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
  if (!canWrite(ctx)) return blocked;
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

const goalSchema = z.object({
  goalName: z.string().trim().min(1, "Informe o nome da meta.").max(80),
  goalKind: z.enum(GOAL_KINDS, { message: "Escolha o tipo." }),
  goalAmount: optionalAmount("Informe o valor como 80.000,00.", { positive: true }).refine(
    (value) => value !== null,
    "Informe quanto custa.",
  ),
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
  if (!canWrite(ctx)) return blocked;
  const hasGoal = text(form, "goalName").trim() !== "" || text(form, "goalAmount").trim() !== "";
  const goal = hasGoal
    ? goalSchema.safeParse({
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
      if (!account) return "Escolha a conta de onde sai.";
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
