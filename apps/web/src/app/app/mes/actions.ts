"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  accounts,
  canWrite,
  cashflowPlans,
  categories,
  ENTRY_KINDS,
  eq,
  transactions,
  withHousehold,
} from "@organizeup/db";
import {
  addMonths,
  isYearMonth,
  occurrenceDate,
  parseBRL,
  toDbAmount,
  yearMonthOf,
} from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface EntryFormState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
}

const READ_ONLY = "Seu papel nesta família não permite alterações.";

const entrySchema = z.object({
  kind: z.enum(ENTRY_KINDS, { message: "Escolha receita ou despesa." }),
  description: z.string().trim().min(1, "Informe a descrição.").max(120),
  amount: z.string().transform((value, ctx) => {
    try {
      const parsed = parseBRL(value);
      if (parsed.lte(0) || parsed.gte("1000000000000")) throw new RangeError("fora do limite");
      return toDbAmount(parsed);
    } catch {
      ctx.addIssue({ code: "custom", message: "Informe um valor maior que zero, como 150,90." });
      return z.NEVER;
    }
  }),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data.")
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Data inválida."),
  categoryId: z.string().min(1, "Escolha a categoria."),
  accountId: z.string().min(1, "Escolha a conta."),
  done: z.boolean(),
  repeat: z.boolean(),
});

export async function addEntry(_prev: EntryFormState, form: FormData): Promise<EntryFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: READ_ONLY };

  const parsed = entrySchema.safeParse({
    kind: form.get("kind"),
    description: form.get("description") ?? "",
    amount: form.get("amount") ?? "",
    date: form.get("date") ?? "",
    categoryId: form.get("categoryId") ?? "",
    accountId: form.get("accountId") ?? "",
    done: form.get("done") === "on",
    repeat: form.get("repeat") === "on",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: null, fieldErrors };
  }
  const data = parsed.data;

  const failure = await withHousehold(ctx, async (tx) => {
    const [category] = await tx
      .select({ kind: categories.kind })
      .from(categories)
      .where(eq(categories.id, data.categoryId));
    if (!category || category.kind !== data.kind) return "Escolha uma categoria válida.";
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, data.accountId));
    if (!account) return "Escolha uma conta válida.";

    const common = {
      householdId: ctx.householdId,
      accountId: data.accountId,
      categoryId: data.categoryId,
      kind: data.kind,
      description: data.description,
      amount: data.amount,
    };
    const month = yearMonthOf(data.date);
    let planId: string | null = null;
    if (data.repeat) {
      const [plan] = await tx
        .insert(cashflowPlans)
        .values({ ...common, dayOfMonth: Number(data.date.slice(8, 10)), startMonth: month })
        .returning({ id: cashflowPlans.id });
      planId = plan!.id;
      await audit(tx, ctx, "create", "cashflow_plans", planId);
    }
    // Recorrente ainda não acontecido fica só como previsão calculada, sem lançamento.
    if (!data.repeat || data.done) {
      const [created] = await tx
        .insert(transactions)
        .values({
          ...common,
          occurredOn: data.date,
          status: data.done ? "realizado" : "previsto",
          planId,
          planMonth: planId ? month : null,
          createdBy: ctx.userId,
        })
        .returning({ id: transactions.id });
      await audit(tx, ctx, "create", "transactions", created!.id);
    }
    return null;
  });
  if (failure) return { ok: false, message: failure };

  revalidatePath("/app", "layout");
  return { ok: true, message: "Lançamento salvo." };
}

/** Marca como pago/recebido. `key` é `t:<lançamento>` ou `p:<previsão>` (com `month`). */
export async function confirmEntry(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const key = String(form.get("key") ?? "");
  const month = String(form.get("month") ?? "");
  const id = key.slice(2);

  await withHousehold(ctx, async (tx) => {
    if (key.startsWith("t:")) {
      await tx
        .update(transactions)
        .set({ status: "realizado", updatedAt: new Date() })
        .where(eq(transactions.id, id));
      await audit(tx, ctx, "confirm", "transactions", id);
    } else if (key.startsWith("p:") && isYearMonth(month)) {
      const [plan] = await tx.select().from(cashflowPlans).where(eq(cashflowPlans.id, id));
      if (!plan) return;
      await tx
        .insert(transactions)
        .values({
          householdId: ctx.householdId,
          accountId: plan.accountId,
          categoryId: plan.categoryId,
          kind: plan.kind,
          description: plan.description,
          amount: plan.amount,
          occurredOn: occurrenceDate(plan.dayOfMonth, month),
          status: "realizado",
          planId: plan.id,
          planMonth: month,
          createdBy: ctx.userId,
        })
        .onConflictDoNothing();
      await audit(tx, ctx, "confirm", "cashflow_plans", id);
    }
  });
  revalidatePath("/app", "layout");
}

export async function deleteEntry(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const removed = await tx
      .delete(transactions)
      .where(eq(transactions.id, id))
      .returning({ id: transactions.id });
    if (removed.length > 0) await audit(tx, ctx, "delete", "transactions", id);
  });
  revalidatePath("/app", "layout");
}

/** Para a previsão a partir do mês informado; o histórico continua. */
export async function stopPlan(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  const month = String(form.get("month") ?? "");
  if (!isYearMonth(month)) return;
  await withHousehold(ctx, async (tx) => {
    await tx
      .update(cashflowPlans)
      .set({ endMonth: addMonths(month, -1) })
      .where(eq(cashflowPlans.id, id));
    await audit(tx, ctx, "stop", "cashflow_plans", id);
  });
  revalidatePath("/app", "layout");
}
