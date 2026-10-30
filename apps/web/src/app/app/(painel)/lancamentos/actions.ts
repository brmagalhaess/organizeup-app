"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  accounts,
  and,
  canWrite,
  cardPurchases,
  cardStatementPayments,
  cashflowPlans,
  categories,
  creditCards,
  debtInstallments,
  ENTRY_KINDS,
  eq,
  transactions,
  withHousehold,
} from "@organizeup/db";
import {
  addMonths,
  formatYearMonth,
  isYearMonth,
  linesTotal,
  occurrenceDate,
  parseBRL,
  purchaseLines,
  statementDueDate,
  toDbAmount,
  yearMonthOf,
} from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { openInstallment, systemCategories } from "@/lib/commitments";
import { requireTenant } from "@/lib/session";

export interface EntryFormState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
}

const READ_ONLY = "Seu papel nesta família não permite alterações.";

const entrySchema = z.object({
  key: z.string(),
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
  installments: z.coerce
    .number({ message: "Informe de 1 a 72 parcelas." })
    .int("Informe de 1 a 72 parcelas.")
    .min(1, "Informe de 1 a 72 parcelas.")
    .max(72, "Informe de 1 a 72 parcelas."),
});

/** Cria um lançamento ou edita o da `key` (`t:<lançamento>` ou `p:<previsão>`). */
export async function saveEntry(_prev: EntryFormState, form: FormData): Promise<EntryFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: READ_ONLY };

  const parsed = entrySchema.safeParse({
    key: form.get("key") ?? "",
    kind: form.get("kind"),
    description: form.get("description") ?? "",
    amount: form.get("amount") ?? "",
    date: form.get("date") ?? "",
    categoryId: form.get("categoryId") ?? "",
    accountId: form.get("accountId") ?? "",
    done: form.get("done") === "on",
    repeat: form.get("repeat") === "on",
    installments: form.get("installments") ?? "1",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: null, fieldErrors };
  }
  const data = parsed.data;
  const id = data.key.slice(2);

  const failure = await withHousehold(ctx, async (tx) => {
    const [category] = await tx
      .select({ kind: categories.kind })
      .from(categories)
      .where(eq(categories.id, data.categoryId));
    if (!category || category.kind !== data.kind) return "Escolha uma categoria válida.";

    if (data.accountId.startsWith("card:")) {
      if (data.kind !== "despesa") return "Cartão recebe apenas despesas.";
      const cardId = data.accountId.slice(5);
      const [card] = await tx.select().from(creditCards).where(eq(creditCards.id, cardId));
      if (!card) return "Escolha um cartão válido.";
      const paid = await tx
        .select({ month: cardStatementPayments.statementMonth })
        .from(cardStatementPayments)
        .where(eq(cardStatementPayments.cardId, cardId));
      const months = new Set(paid.map((row) => row.month));
      const blocked = purchaseLines(
        {
          id: "",
          cardId,
          categoryId: data.categoryId,
          description: data.description,
          amount: data.amount,
          installments: data.installments,
          purchasedOn: data.date,
        },
        card,
      ).find((line) => months.has(line.statementMonth));
      if (blocked)
        return `A fatura de ${formatYearMonth(blocked.statementMonth)} já foi paga. Use uma data depois do fechamento dela.`;
      const [created] = await tx
        .insert(cardPurchases)
        .values({
          householdId: ctx.householdId,
          cardId,
          categoryId: data.categoryId,
          description: data.description,
          amount: data.amount,
          installments: data.installments,
          purchasedOn: data.date,
          createdBy: ctx.userId,
        })
        .returning({ id: cardPurchases.id });
      await audit(tx, ctx, "create", "card_purchases", created!.id);
      return null;
    }

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

    if (data.key.startsWith("t:")) {
      const [current] = await tx.select().from(transactions).where(eq(transactions.id, id));
      if (!current) return "Lançamento não encontrado.";
      // A previsão só some do mês do lançamento ligado a ela; trocar de mês a faria voltar.
      if (current.planId && current.planMonth !== month)
        return "Lançamento de conta recorrente precisa continuar no mesmo mês.";
      await tx
        .update(transactions)
        .set({
          ...common,
          occurredOn: data.date,
          status: data.done ? "realizado" : "previsto",
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, id));
      await audit(tx, ctx, "update", "transactions", id);
      return null;
    }

    if (data.key.startsWith("p:")) {
      const updated = await tx
        .update(cashflowPlans)
        .set({ ...common, dayOfMonth: Number(data.date.slice(8, 10)) })
        .where(eq(cashflowPlans.id, id))
        .returning({ id: cashflowPlans.id });
      if (updated.length === 0) return "Previsão não encontrada.";
      await audit(tx, ctx, "update", "cashflow_plans", id);
      return null;
    }

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

/**
 * Marca como pago/recebido. `key` é `t:<lançamento>`, `p:<previsão>` (com `month`),
 * `d:<parcela>` ou `f:<cartão>:<mês>`.
 */
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
    } else if (key.startsWith("d:")) {
      const open = await openInstallment(tx, id);
      const { debt: categoryId } = await systemCategories(tx);
      if (!open || !categoryId) return;
      const { installment, debt, total } = open;
      const [created] = await tx
        .insert(transactions)
        .values({
          householdId: ctx.householdId,
          accountId: debt.accountId,
          categoryId,
          kind: "despesa",
          description: `${debt.name} (${installment.number}/${total})`,
          amount: installment.amount,
          occurredOn: installment.dueDate,
          status: "realizado",
          createdBy: ctx.userId,
        })
        .returning({ id: transactions.id });
      await tx
        .update(debtInstallments)
        .set({ transactionId: created!.id })
        .where(eq(debtInstallments.id, id));
      await audit(tx, ctx, "confirm", "debt_installments", id);
    } else if (key.startsWith("f:")) {
      const [, cardId = "", statementMonth = ""] = key.split(":");
      if (!isYearMonth(statementMonth)) return;
      const [card] = await tx.select().from(creditCards).where(eq(creditCards.id, cardId));
      const { card: categoryId } = await systemCategories(tx);
      if (!card || !categoryId) return;
      const [paid] = await tx
        .select({ id: cardStatementPayments.id })
        .from(cardStatementPayments)
        .where(
          and(
            eq(cardStatementPayments.cardId, cardId),
            eq(cardStatementPayments.statementMonth, statementMonth),
          ),
        );
      if (paid) return;
      const purchases = await tx
        .select()
        .from(cardPurchases)
        .where(eq(cardPurchases.cardId, cardId));
      const lines = purchases
        .flatMap((purchase) => purchaseLines(purchase, card))
        .filter((line) => line.statementMonth === statementMonth);
      if (lines.length === 0) return;
      const [created] = await tx
        .insert(transactions)
        .values({
          householdId: ctx.householdId,
          accountId: card.payingAccountId,
          categoryId,
          kind: "despesa",
          description: `Fatura ${card.name}`,
          amount: linesTotal(lines),
          occurredOn: statementDueDate(statementMonth, card),
          status: "realizado",
          createdBy: ctx.userId,
        })
        .returning({ id: transactions.id });
      await tx.insert(cardStatementPayments).values({
        householdId: ctx.householdId,
        cardId,
        statementMonth,
        transactionId: created!.id,
      });
      await audit(tx, ctx, "confirm", "card_statement_payments", cardId);
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
