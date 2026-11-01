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
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import { parseBRL, toDbAmount } from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface ReserveFormState {
  ok: boolean;
  message: string | null;
}

const READ_ONLY: ReserveFormState = {
  ok: false,
  message: "Seu papel nesta família não permite alterações.",
};

const monthsSchema = z.coerce
  .number({ message: "Informe de 1 a 60 meses." })
  .int("Informe de 1 a 60 meses.")
  .min(1, "Informe de 1 a 60 meses.")
  .max(60, "Informe de 1 a 60 meses.");

type FundPatch = Partial<
  Pick<typeof emergencyFund.$inferInsert, "targetMonths" | "monthlyAmount" | "contribution">
>;

/** Muda só o que veio em `patch`: cada parte da tela salva por conta própria. */
async function saveFund(ctx: TenantContext, patch: FundPatch, message: string) {
  await withHousehold(ctx, async (tx) => {
    await tx
      .insert(emergencyFund)
      .values({ householdId: ctx.householdId, ...patch })
      .onConflictDoUpdate({
        target: emergencyFund.householdId,
        set: { ...patch, updatedAt: new Date() },
      });
    await audit(tx, ctx, "update", "emergency_fund", ctx.householdId);
  });
  revalidatePath("/app", "layout");
  return { ok: true, message };
}

/** Valor em reais opcional: em branco vira null. Lança erro se não for um valor válido. */
function optionalAmount(raw: FormDataEntryValue | null): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const value = parseBRL(text);
  if (value.lte(0) || value.gte("1000000000000")) throw new RangeError("fora do limite");
  return toDbAmount(value);
}

/** Quantos meses de gasto essencial a reserva deve cobrir. */
export async function saveReserveMonths(
  _prev: ReserveFormState,
  form: FormData,
): Promise<ReserveFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return READ_ONLY;
  const parsed = monthsSchema.safeParse(form.get("targetMonths"));
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };
  return saveFund(ctx, { targetMonths: parsed.data }, "Meses salvos.");
}

/** Gasto essencial informado pela família. Em branco, volta a ser calculado pelos lançamentos. */
export async function saveReserveEssential(
  _prev: ReserveFormState,
  form: FormData,
): Promise<ReserveFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return READ_ONLY;
  let monthlyAmount: string | null;
  try {
    monthlyAmount = optionalAmount(form.get("monthly"));
  } catch {
    return { ok: false, message: "Informe o gasto essencial como 3.500,00." };
  }
  return saveFund(ctx, { monthlyAmount }, "Gasto essencial salvo.");
}

/** Quanto a família separa por mês para a reserva. Não é o gasto essencial. */
export async function saveReserveContribution(
  _prev: ReserveFormState,
  form: FormData,
): Promise<ReserveFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return READ_ONLY;
  let contribution: string | null;
  try {
    contribution = optionalAmount(form.get("contribution"));
  } catch {
    return { ok: false, message: "Informe quanto guardar por mês como 500,00." };
  }
  return saveFund(ctx, { contribution }, "Valor salvo.");
}

const toggleSchema = z.object({ accountId: z.string().min(1), selected: z.boolean() });

/** Marca ou desmarca uma conta como parte da reserva (ADR-0007: a conta entra inteira). */
export async function toggleReserveAccount(
  accountId: string,
  selected: boolean,
): Promise<ReserveFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return READ_ONLY;
  const parsed = toggleSchema.safeParse({ accountId, selected });
  if (!parsed.success) return { ok: false, message: "Conta inválida." };

  const changed = await withHousehold(ctx, async (tx) => {
    if (!parsed.data.selected) {
      await tx
        .delete(earmarks)
        .where(and(eq(earmarks.accountId, parsed.data.accountId), eq(earmarks.purpose, "reserva")));
    } else {
      const [account] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, parsed.data.accountId), eq(accounts.archived, false)));
      if (!account) return false;
      await tx
        .insert(earmarks)
        .values({ householdId: ctx.householdId, accountId: account.id, purpose: "reserva" })
        .onConflictDoNothing();
    }
    await audit(tx, ctx, "update", "emergency_fund", ctx.householdId);
    return true;
  });
  if (!changed) return { ok: false, message: "Esta conta não está mais disponível." };
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}
