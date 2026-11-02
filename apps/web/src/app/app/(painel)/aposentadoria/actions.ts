"use server";
import { getLocale, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { applySuggestion, dismissSuggestion } from "@organizeup/agents";
import {
  and,
  canWrite,
  desc,
  emergencyFund,
  eq,
  householdCurrency,
  householdSuggestions,
  people,
  retirementPlan,
  retirementScenarios,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import { brazilRulesApply, money, parseMoney, toDbAmount } from "@organizeup/domain";
import type { Locale } from "@/i18n/locales";
import { audit } from "@/lib/audit";
import { requireModule } from "@/lib/billing/plan-gate";

export interface FormState {
  ok: boolean;
  message: string | null;
}

type Errors = Awaited<ReturnType<typeof getTranslations<"aposentadoria.errors">>>;

const blocked = async (): Promise<FormState> => ({
  ok: false,
  message: (await getTranslations("settings"))("noPermission"),
});

const number = (message: string, min: string, max: string, locale: Locale) =>
  z.string().transform((value, ctx) => {
    try {
      const parsed = parseMoney(value, locale);
      if (parsed.lt(min) || parsed.gt(max)) throw new RangeError("fora do limite");
      return toDbAmount(parsed);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });
const reais = (message: string, locale: Locale) => number(message, "0", "999999999999", locale);

const scenarioSchema = (t: Errors, locale: Locale) =>
  z
    .object({
      id: z.string(),
      personId: z.string().min(1, t("personRequired")),
      birth: z
        .string()
        .regex(/^(\d{4}-\d{2})?$/, t("birthInvalid"))
        .transform((value) => value || null),
      name: z.string().trim().min(1, t("nameRequired")).max(60),
      targetAge: z.coerce
        .number({ message: t("targetAgeRequired") })
        .int()
        .min(30, t("targetAgeMin"))
        .max(100, t("targetAgeMax")),
      lifeExpectancy: z.coerce
        .number({ message: t("lifeExpectancyRequired") })
        .int()
        .min(50, t("lifeExpectancyMin"))
        .max(120, t("lifeExpectancyMax")),
      targetIncome: reais(t("targetIncomeFormat"), locale),
      otherIncome: reais(t("otherIncomeFormat"), locale),
      monthlyContribution: reais(t("contributionFormat"), locale),
      saved: z.string(),
      returnBefore: number(t("returnRange"), "-5", "20", locale),
      returnAfter: number(t("returnRange"), "-5", "20", locale),
    })
    .refine((v) => v.lifeExpectancy > v.targetAge, {
      message: t("lifeExpectancyAfterTarget"),
    });

/** Cria um cenário ou edita o do `id`. */
export async function saveScenario(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireModule("aposentadoria");
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await Promise.all([getTranslations("aposentadoria.errors"), getLocale()]);
  const parsed = scenarioSchema(t, locale).safeParse({
    id: form.get("id") ?? "",
    personId: form.get("personId") ?? "",
    birth: form.get("birth") ?? "",
    name: form.get("name") ?? "",
    targetAge: form.get("targetAge"),
    lifeExpectancy: form.get("lifeExpectancy"),
    targetIncome: form.get("targetIncome") ?? "",
    // INSS e outras rendas só existem com as regras brasileiras: fora delas, carteira e renda alvo.
    otherIncome: brazilRulesApply(await withHousehold(ctx, householdCurrency))
      ? form.get("otherIncome") || "0"
      : "0",
    monthlyContribution: form.get("monthlyContribution") || "0",
    saved: form.get("saved") ?? "",
    returnBefore: form.get("returnBefore") ?? "",
    returnAfter: form.get("returnAfter") ?? "",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t("check") };
  const { id, birth, ...values } = parsed.data;
  const savedRaw = values.saved.trim();
  const saved = savedRaw ? reais(t("savedFormat"), locale).safeParse(savedRaw) : null;
  if (saved && !saved.success)
    return { ok: false, message: saved.error.issues[0]?.message ?? t("check") };
  const row = { ...values, saved: saved ? saved.data : null };

  const failure = await withHousehold(ctx, async (tx) => {
    const [person] = await tx.select().from(people).where(eq(people.id, values.personId));
    if (!person) return t("personInvalid");
    if (!person.birthYear || !person.birthMonth) {
      if (!birth) return t("birthRequired");
      const [year, month] = birth.split("-").map(Number);
      await tx
        .update(people)
        .set({ birthYear: year!, birthMonth: month! })
        .where(eq(people.id, person.id));
      await audit(tx, ctx, "update", "people", person.id);
    }
    if (id) {
      await tx.update(retirementScenarios).set(row).where(eq(retirementScenarios.id, id));
      await audit(tx, ctx, "update", "retirement_scenarios", id);
    } else {
      const [created] = await tx
        .insert(retirementScenarios)
        .values({ householdId: ctx.householdId, ...row })
        .returning({ id: retirementScenarios.id });
      await audit(tx, ctx, "create", "retirement_scenarios", created!.id);
    }
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}

export async function deleteScenario(form: FormData): Promise<void> {
  const { ctx } = await requireModule("aposentadoria");
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const removed = await tx
      .delete(retirementScenarios)
      .where(eq(retirementScenarios.id, id))
      .returning({ id: retirementScenarios.id });
    if (removed.length > 0) await audit(tx, ctx, "delete", "retirement_scenarios", id);
  });
  revalidatePath("/app", "layout");
}

/** Número opcional: vazio vira null, para o plano usar o valor derivado. */
const optional = (message: string, min: string, max: string, locale: Locale) =>
  z.string().transform((value, ctx) => {
    if (!value.trim()) return null;
    const parsed = number(message, min, max, locale).safeParse(value);
    if (parsed.success) return parsed.data;
    ctx.addIssue({ code: "custom", message });
    return z.NEVER;
  });

const planSchema = (t: Errors, locale: Locale) =>
  z.object({
    targetIncome: optional(t("targetIncomeFormat"), "0.01", "999999999999", locale),
    expectedYield: optional(t("yieldRange"), "0.01", "30", locale),
    monthlyContribution: optional(t("planContributionFormat"), "0", "999999999999", locale),
    dividendGrowth: number(t("growthRange"), "-5", "15", locale),
  });

/** Grava o que a família informou no plano de viver dos rendimentos. */
export async function saveRetirementPlan(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireModule("aposentadoria");
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await Promise.all([getTranslations("aposentadoria.errors"), getLocale()]);
  const parsed = planSchema(t, locale).safeParse({
    targetIncome: form.get("targetIncome") ?? "",
    expectedYield: form.get("expectedYield") ?? "",
    monthlyContribution: form.get("monthlyContribution") ?? "",
    dividendGrowth: form.get("dividendGrowth") || "0",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t("check") };

  await withHousehold(ctx, async (tx) => {
    await tx
      .insert(retirementPlan)
      .values({ householdId: ctx.householdId, ...parsed.data })
      .onConflictDoUpdate({
        target: retirementPlan.householdId,
        set: { ...parsed.data, updatedAt: new Date() },
      });
    await audit(tx, ctx, "update", "retirement_plan", ctx.householdId);
  });
  revalidatePath("/app", "layout");
  return { ok: true, message: t("planSaved") };
}

/**
 * Aceita a sugestão pendente mais nova do tipo e dispensa as de meses anteriores. A sugestão é da
 * madrugada e a tela recalcula na hora: se os valores divergem, ou não há sugestão, grava direto o
 * valor que a família viu.
 */
async function acceptAmount(
  tx: TenantTx,
  ctx: TenantContext,
  kind: "aporte_reserva" | "aporte_investimento",
  amount: string,
  write: () => Promise<void>,
) {
  if (money(amount).isZero()) return;
  const [newest, ...older] = await tx
    .select({ id: householdSuggestions.id, payload: householdSuggestions.payload })
    .from(householdSuggestions)
    .where(and(eq(householdSuggestions.status, "pendente"), eq(householdSuggestions.kind, kind)))
    .orderBy(desc(householdSuggestions.createdAt));
  for (const row of older) await dismissSuggestion(tx, ctx, row.id);
  const applied = newest ? await applySuggestion(tx, ctx, newest.id) : null;
  if (applied?.ok && newest?.payload.monthlyAmount === amount) return;
  await write();
}

const shownAmount = z.string().regex(/^\d+\.\d{2}$/);

/** "Aceitar este valor": grava quanto guardar por mês na reserva e nos investimentos. */
export async function acceptSavingAmounts(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireModule("aposentadoria");
  if (!canWrite(ctx)) return blocked();
  const reserve = shownAmount.safeParse(form.get("reserve"));
  const investment = shownAmount.safeParse(form.get("investment"));
  if (!reserve.success || !investment.success) {
    const t = await getTranslations("aposentadoria.errors");
    return { ok: false, message: t("reload") };
  }

  await withHousehold(ctx, async (tx) => {
    await acceptAmount(tx, ctx, "aporte_reserva", reserve.data, async () => {
      await tx
        .insert(emergencyFund)
        .values({ householdId: ctx.householdId, contribution: reserve.data })
        .onConflictDoUpdate({
          target: emergencyFund.householdId,
          set: { contribution: reserve.data, updatedAt: new Date() },
        });
      await audit(tx, ctx, "update", "emergency_fund", ctx.householdId);
    });
    await acceptAmount(tx, ctx, "aporte_investimento", investment.data, async () => {
      await tx
        .insert(retirementPlan)
        .values({ householdId: ctx.householdId, monthlyContribution: investment.data })
        .onConflictDoUpdate({
          target: retirementPlan.householdId,
          set: { monthlyContribution: investment.data, updatedAt: new Date() },
        });
      await audit(tx, ctx, "update", "retirement_plan", ctx.householdId);
    });
  });
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}
