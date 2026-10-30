"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canWrite, eq, people, retirementScenarios, withHousehold } from "@organizeup/db";
import { parseBRL, toDbAmount } from "@organizeup/domain";
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
