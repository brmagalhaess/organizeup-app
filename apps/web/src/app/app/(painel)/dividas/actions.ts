"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  accounts,
  canWrite,
  debtInstallments,
  debts,
  DEBT_SYSTEMS,
  eq,
  withHousehold,
} from "@organizeup/db";
import { buildSchedule, money, parseBRL, toDbAmount } from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface DebtFormState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
}

const READ_ONLY = "Seu papel nesta família não permite alterações.";

const positiveAmount = (message: string) =>
  z.string().transform((value, ctx) => {
    try {
      const parsed = parseBRL(value);
      if (parsed.lte(0) || parsed.gte("1000000000000")) throw new RangeError("fora do limite");
      return toDbAmount(parsed);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });

const debtSchema = z
  .object({
    system: z.enum(DEBT_SYSTEMS, { message: "Escolha como são as parcelas." }),
    balance: z.string(),
    installmentAmount: z.string(),
    monthlyRate: z.string().transform((value, ctx) => {
      try {
        const parsed = parseBRL(value.trim() || "0");
        if (parsed.lt(0) || parsed.gt(100)) throw new RangeError("fora do limite");
        return parsed.toFixed(4);
      } catch {
        ctx.addIssue({ code: "custom", message: "Informe os juros como 2,15." });
        return z.NEVER;
      }
    }),
    installments: z.coerce
      .number({ message: "Informe quantas parcelas faltam." })
      .int("Informe quantas parcelas faltam.")
      .min(1, "Informe quantas parcelas faltam.")
      .max(480, "O limite é de 480 parcelas."),
    firstDueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe o próximo vencimento.")
      .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Data inválida."),
  })
  .superRefine((data, ctx) => {
    const field = data.system === "manual" ? "installmentAmount" : "balance";
    const message =
      data.system === "manual"
        ? "Informe o valor da parcela, como 450,00."
        : "Informe o saldo devedor, como 12.500,00.";
    const parsed = positiveAmount(message).safeParse(data[field]);
    if (!parsed.success) ctx.addIssue({ code: "custom", path: [field], message });
  });

const commonSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1, "Informe o nome da dívida.").max(80),
  accountId: z.string().min(1, "Escolha a conta."),
});

function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

/** Cria a dívida com seu calendário. Na edição, só nome e conta mudam. */
export async function saveDebt(_prev: DebtFormState, form: FormData): Promise<DebtFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: READ_ONLY };

  const common = commonSchema.safeParse({
    id: form.get("id") ?? "",
    name: form.get("name") ?? "",
    accountId: form.get("accountId") ?? "",
  });
  if (!common.success) return { ok: false, message: null, fieldErrors: fieldErrors(common.error) };
  const { id, name, accountId } = common.data;

  if (id) {
    const failure = await withHousehold(ctx, async (tx) => {
      const [account] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, accountId));
      if (!account) return "Escolha uma conta válida.";
      await tx.update(debts).set({ name, accountId }).where(eq(debts.id, id));
      await audit(tx, ctx, "update", "debts", id);
      return null;
    });
    if (failure) return { ok: false, message: failure };
    revalidatePath("/app", "layout");
    return { ok: true, message: "Dívida salva." };
  }

  const parsed = debtSchema.safeParse({
    system: form.get("system"),
    balance: form.get("balance") ?? "",
    installmentAmount: form.get("installmentAmount") ?? "",
    monthlyRate: form.get("monthlyRate") ?? "",
    installments: form.get("installments"),
    firstDueDate: form.get("firstDueDate") ?? "",
  });
  if (!parsed.success) return { ok: false, message: null, fieldErrors: fieldErrors(parsed.error) };
  const data = parsed.data;
  const schedule = buildSchedule({
    system: data.system,
    balance: data.balance ? toDbAmount(parseBRL(data.balance)) : "0",
    monthlyRate: data.monthlyRate,
    installments: data.installments,
    firstDueDate: data.firstDueDate,
    ...(data.installmentAmount
      ? { installmentAmount: toDbAmount(parseBRL(data.installmentAmount)) }
      : {}),
  });

  const failure = await withHousehold(ctx, async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (!account) return "Escolha uma conta válida.";
    const [debt] = await tx
      .insert(debts)
      .values({
        householdId: ctx.householdId,
        accountId,
        name,
        system: data.system,
        monthlyRate: data.monthlyRate,
        originalBalance: toDbAmount(
          schedule.reduce((acc, row) => acc.plus(row.principal), money(0)),
        ),
        createdBy: ctx.userId,
      })
      .returning({ id: debts.id });
    await tx
      .insert(debtInstallments)
      .values(schedule.map((row) => ({ ...row, householdId: ctx.householdId, debtId: debt!.id })));
    await audit(tx, ctx, "create", "debts", debt!.id);
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Dívida criada." };
}

/** Sem parcela paga, apaga. Com histórico, encerra: as parcelas em aberto saem do mês. */
export async function closeDebt(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const rows = await tx
      .select({ transactionId: debtInstallments.transactionId })
      .from(debtInstallments)
      .where(eq(debtInstallments.debtId, id));
    if (rows.some((row) => row.transactionId !== null)) {
      await tx.update(debts).set({ archived: true }).where(eq(debts.id, id));
      await audit(tx, ctx, "archive", "debts", id);
    } else {
      await tx.delete(debts).where(eq(debts.id, id));
      await audit(tx, ctx, "delete", "debts", id);
    }
  });
  revalidatePath("/app", "layout");
}

export async function reopenDebt(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    await tx.update(debts).set({ archived: false }).where(eq(debts.id, id));
    await audit(tx, ctx, "restore", "debts", id);
  });
  revalidatePath("/app", "layout");
}
