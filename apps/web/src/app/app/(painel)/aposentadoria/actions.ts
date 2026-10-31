"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { applySuggestion, dismissSuggestion } from "@organizeup/agents";
import {
  and,
  canWrite,
  desc,
  emergencyFund,
  eq,
  householdSuggestions,
  people,
  retirementPlan,
  retirementScenarios,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import { money, parseBRL, toDbAmount } from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface FormState {
  ok: boolean;
  message: string | null;
}

const number = (message: string, min: string, max: string) =>
  z.string().transform((value, ctx) => {
    try {
      const parsed = parseBRL(value);
      if (parsed.lt(min) || parsed.gt(max)) throw new RangeError("fora do limite");
      return toDbAmount(parsed);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });
const reais = (message: string) => number(message, "0", "999999999999");

const schema = z
  .object({
    id: z.string(),
    personId: z.string().min(1, "Escolha a pessoa."),
    birth: z
      .string()
      .regex(/^(\d{4}-\d{2})?$/, "Use mês e ano válidos.")
      .transform((value) => value || null),
    name: z.string().trim().min(1, "Dê um nome ao cenário.").max(60),
    targetAge: z.coerce
      .number({ message: "Informe a idade." })
      .int()
      .min(30, "Use idade a partir de 30.")
      .max(100, "Use idade até 100."),
    lifeExpectancy: z.coerce
      .number({ message: "Informe até que idade planejar." })
      .int()
      .min(50, "Use idade a partir de 50.")
      .max(120, "Use idade até 120."),
    targetIncome: reais("Informe a renda como 8.000,00."),
    otherIncome: reais("Informe o INSS e outras rendas como 3.000,00."),
    monthlyContribution: reais("Informe o aporte como 1.000,00."),
    saved: z.string(),
    returnBefore: number("Use retorno entre -5% e 20% ao ano.", "-5", "20"),
    returnAfter: number("Use retorno entre -5% e 20% ao ano.", "-5", "20"),
  })
  .refine((v) => v.lifeExpectancy > v.targetAge, {
    message: "Planeje até uma idade maior que a de parar.",
  });

/** Cria um cenário ou edita o do `id`. */
export async function saveScenario(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx))
    return { ok: false, message: "Seu papel nesta família não permite alterações." };
  const parsed = schema.safeParse({
    id: form.get("id") ?? "",
    personId: form.get("personId") ?? "",
    birth: form.get("birth") ?? "",
    name: form.get("name") ?? "",
    targetAge: form.get("targetAge"),
    lifeExpectancy: form.get("lifeExpectancy"),
    targetIncome: form.get("targetIncome") ?? "",
    otherIncome: form.get("otherIncome") || "0",
    monthlyContribution: form.get("monthlyContribution") || "0",
    saved: form.get("saved") ?? "",
    returnBefore: form.get("returnBefore") ?? "",
    returnAfter: form.get("returnAfter") ?? "",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };
  const { id, birth, ...values } = parsed.data;
  const savedRaw = values.saved.trim();
  const saved = savedRaw ? reais("Informe o valor como 50.000,00.").safeParse(savedRaw) : null;
  if (saved && !saved.success)
    return { ok: false, message: saved.error.issues[0]?.message ?? "Verifique." };
  const row = { ...values, saved: saved ? saved.data : null };

  const failure = await withHousehold(ctx, async (tx) => {
    const [person] = await tx.select().from(people).where(eq(people.id, values.personId));
    if (!person) return "Escolha uma pessoa válida.";
    if (!person.birthYear || !person.birthMonth) {
      if (!birth) return "Informe o mês e o ano de nascimento.";
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
  const { ctx } = await requireTenant();
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
const optional = (message: string, min: string, max: string) =>
  z.string().transform((value, ctx) => {
    if (!value.trim()) return null;
    const parsed = number(message, min, max).safeParse(value);
    if (parsed.success) return parsed.data;
    ctx.addIssue({ code: "custom", message });
    return z.NEVER;
  });

const planSchema = z.object({
  targetIncome: optional("Informe a renda como 8.000,00.", "0.01", "999999999999"),
  expectedYield: optional("Use rendimento anual entre 0,01% e 30%.", "0.01", "30"),
  monthlyContribution: optional("Informe o valor como 1.000,00.", "0", "999999999999"),
  dividendGrowth: number("Use crescimento entre -5% e 15% ao ano.", "-5", "15"),
});

/** Grava o que a família informou no plano de viver dos rendimentos. */
export async function saveRetirementPlan(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx))
    return { ok: false, message: "Seu papel nesta família não permite alterações." };
  const parsed = planSchema.safeParse({
    targetIncome: form.get("targetIncome") ?? "",
    expectedYield: form.get("expectedYield") ?? "",
    monthlyContribution: form.get("monthlyContribution") ?? "",
    dividendGrowth: form.get("dividendGrowth") || "0",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };

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
  return { ok: true, message: "Plano salvo." };
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
  const { ctx } = await requireTenant();
  if (!canWrite(ctx))
    return { ok: false, message: "Seu papel nesta família não permite alterações." };
  const reserve = shownAmount.safeParse(form.get("reserve"));
  const investment = shownAmount.safeParse(form.get("investment"));
  if (!reserve.success || !investment.success)
    return { ok: false, message: "Recarregue a página e tente de novo." };

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
