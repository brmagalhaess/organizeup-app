"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  accounts,
  canWrite,
  categories,
  eq,
  householdTimezone,
  INCOME_KINDS,
  incomeReceipts,
  incomeSources,
  people,
  withHousehold,
} from "@organizeup/db";
import {
  addMonths,
  firstIncomeMonth,
  parseBRL,
  toDbAmount,
  todayIn,
  yearMonthOf,
} from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface IncomeFormState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
}

const READ_ONLY = "Seu papel nesta família não permite alterações.";
const LIMIT = "1000000000000";

const amountField = (message: string, optional = false) =>
  z.string().transform((value, ctx) => {
    if (optional && !value.trim()) return "0.00";
    try {
      const parsed = parseBRL(value);
      if (parsed.lt(0) || parsed.gte(LIMIT) || (!optional && parsed.isZero()))
        throw new RangeError("fora do limite");
      return toDbAmount(parsed);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });

const schema = z.object({
  id: z.string(),
  name: z.string().trim().min(1, "Informe de onde vem a renda.").max(80),
  kind: z.enum(INCOME_KINDS, { message: "Escolha o tipo de renda." }),
  amount: amountField("Informe o valor, como 4.500,00."),
  dependents: z.coerce
    .number({ message: "Informe de 0 a 20 dependentes." })
    .int("Informe de 0 a 20 dependentes.")
    .min(0, "Informe de 0 a 20 dependentes.")
    .max(20, "Informe de 0 a 20 dependentes."),
  pensionAmount: amountField("Informe a pensão como 300,00.", true),
  otherDiscounts: amountField("Informe os descontos como 150,00.", true),
  vacationMonth: z.coerce.number().int().min(0).max(12),
  payDay: z.coerce
    .number({ message: "Informe o dia do pagamento, de 1 a 31." })
    .int("Informe o dia do pagamento, de 1 a 31.")
    .min(1, "Informe o dia do pagamento, de 1 a 31.")
    .max(31, "Informe o dia do pagamento, de 1 a 31."),
  accountId: z.string().min(1, "Escolha a conta."),
  categoryId: z.string().min(1, "Escolha a categoria."),
  personId: z.string(),
});

/** Cria uma renda ou edita a do `id`. Só a CLT é calculada pelo bruto. */
export async function saveIncome(_prev: IncomeFormState, form: FormData): Promise<IncomeFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: READ_ONLY };
  const parsed = schema.safeParse({
    id: form.get("id") ?? "",
    name: form.get("name") ?? "",
    kind: form.get("kind"),
    amount: form.get("amount") ?? "",
    dependents: form.get("dependents") || "0",
    pensionAmount: form.get("pensionAmount") ?? "",
    otherDiscounts: form.get("otherDiscounts") ?? "",
    vacationMonth: form.get("vacationMonth") || "0",
    payDay: form.get("payDay"),
    accountId: form.get("accountId") ?? "",
    categoryId: form.get("categoryId") ?? "",
    personId: form.get("personId") ?? "",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: null, fieldErrors };
  }
  const data = parsed.data;
  const clt = data.kind === "clt";
  const values = {
    name: data.name,
    kind: data.kind,
    amount: data.amount,
    isGross: clt,
    dependents: clt ? data.dependents : 0,
    pensionAmount: clt ? data.pensionAmount : "0",
    otherDiscounts: clt ? data.otherDiscounts : "0",
    vacationMonth: clt && data.vacationMonth > 0 ? data.vacationMonth : null,
    payDay: data.payDay,
    accountId: data.accountId,
    categoryId: data.categoryId,
    personId: data.personId || null,
  };

  const failure = await withHousehold(ctx, async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, data.accountId));
    if (!account) return "Escolha uma conta válida.";
    const [category] = await tx
      .select({ kind: categories.kind })
      .from(categories)
      .where(eq(categories.id, data.categoryId));
    if (category?.kind !== "receita") return "Escolha uma categoria de receita.";
    if (values.personId) {
      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        .where(eq(people.id, values.personId));
      if (!person) return "Escolha uma pessoa válida.";
    }

    if (data.id) {
      await tx.update(incomeSources).set(values).where(eq(incomeSources.id, data.id));
      await audit(tx, ctx, "update", "income_sources", data.id);
      return null;
    }
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const [created] = await tx
      .insert(incomeSources)
      .values({
        ...values,
        householdId: ctx.householdId,
        startMonth: firstIncomeMonth(today, data.payDay),
      })
      .returning({ id: incomeSources.id });
    await audit(tx, ctx, "create", "income_sources", created!.id);
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Renda salva." };
}

/** Sem nada recebido, apaga. Com histórico, para de prever a partir deste mês. */
export async function stopIncome(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const received = await tx
      .select({ id: incomeReceipts.id })
      .from(incomeReceipts)
      .where(eq(incomeReceipts.incomeSourceId, id))
      .limit(1);
    if (received.length === 0) {
      await tx.delete(incomeSources).where(eq(incomeSources.id, id));
      await audit(tx, ctx, "delete", "income_sources", id);
      return;
    }
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    await tx
      .update(incomeSources)
      .set({ endMonth: addMonths(yearMonthOf(today), -1) })
      .where(eq(incomeSources.id, id));
    await audit(tx, ctx, "stop", "income_sources", id);
  });
  revalidatePath("/app", "layout");
}
