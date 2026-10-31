"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  accounts,
  and,
  canWrite,
  earmarks,
  emergencyFund,
  eq,
  inArray,
  withHousehold,
} from "@organizeup/db";
import { parseBRL, toDbAmount } from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface ReserveFormState {
  ok: boolean;
  message: string | null;
}

const schema = z.object({
  targetMonths: z.coerce
    .number({ message: "Informe de 1 a 60 meses." })
    .int("Informe de 1 a 60 meses.")
    .min(1, "Informe de 1 a 60 meses.")
    .max(60, "Informe de 1 a 60 meses."),
  monthly: z.string().trim(),
  contribution: z.string().trim(),
  accountIds: z.array(z.string()).max(100),
});

/** Salva a meta e quais contas formam a reserva. */
export async function saveReserve(
  _prev: ReserveFormState,
  form: FormData,
): Promise<ReserveFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx))
    return { ok: false, message: "Seu papel nesta família não permite alterações." };
  const parsed = schema.safeParse({
    targetMonths: form.get("targetMonths"),
    monthly: form.get("monthly") ?? "",
    contribution: form.get("contribution") ?? "",
    accountIds: form.getAll("accountIds").map(String),
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };
  const { targetMonths, accountIds } = parsed.data;

  let monthlyAmount: string | null = null;
  if (parsed.data.monthly) {
    try {
      const value = parseBRL(parsed.data.monthly);
      if (value.lte(0)) throw new RangeError("não positivo");
      monthlyAmount = toDbAmount(value);
    } catch {
      return { ok: false, message: "Informe o gasto essencial como 3.500,00." };
    }
  }

  let contribution: string | null = null;
  if (parsed.data.contribution) {
    try {
      const value = parseBRL(parsed.data.contribution);
      if (value.lte(0) || value.gte("1000000000000")) throw new RangeError("fora do limite");
      contribution = toDbAmount(value);
    } catch {
      return { ok: false, message: "Informe quanto guardar por mês como 500,00." };
    }
  }

  await withHousehold(ctx, async (tx) => {
    await tx
      .insert(emergencyFund)
      .values({ householdId: ctx.householdId, targetMonths, monthlyAmount, contribution })
      .onConflictDoUpdate({
        target: emergencyFund.householdId,
        set: { targetMonths, monthlyAmount, contribution, updatedAt: new Date() },
      });
    await tx.delete(earmarks).where(eq(earmarks.purpose, "reserva"));
    if (accountIds.length > 0) {
      const valid = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(inArray(accounts.id, accountIds), eq(accounts.archived, false)));
      if (valid.length > 0)
        await tx.insert(earmarks).values(
          valid.map((account) => ({
            householdId: ctx.householdId,
            accountId: account.id,
            purpose: "reserva" as const,
          })),
        );
    }
    await audit(tx, ctx, "update", "emergency_fund", ctx.householdId);
  });
  revalidatePath("/app", "layout");
  return { ok: true, message: "Reserva salva." };
}
