"use server";
import { getLocale, getTranslations } from "next-intl/server";
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
import { parseMoney, toDbAmount } from "@organizeup/domain";
import type { Locale } from "@/i18n/locales";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface ReserveFormState {
  ok: boolean;
  message: string | null;
}

const blocked = async (): Promise<ReserveFormState> => ({
  ok: false,
  message: (await getTranslations("settings"))("noPermission"),
});

const monthsSchema = (message: string) =>
  z.coerce.number({ message }).int(message).min(1, message).max(60, message);

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
function optionalAmount(raw: FormDataEntryValue | null, locale: Locale): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const value = parseMoney(text, locale);
  if (value.lte(0) || value.gte("1000000000000")) throw new RangeError("fora do limite");
  return toDbAmount(value);
}

/** Quantos meses de gasto essencial a reserva deve cobrir. */
export async function saveReserveMonths(
  _prev: ReserveFormState,
  form: FormData,
): Promise<ReserveFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked();
  const t = await getTranslations("reserva");
  const parsed = monthsSchema(t("errors.months")).safeParse(form.get("targetMonths"));
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? t("errors.check") };
  return saveFund(ctx, { targetMonths: parsed.data }, t("saved.months"));
}

/** Gasto essencial informado pela família. Em branco, volta a ser calculado pelos lançamentos. */
export async function saveReserveEssential(
  _prev: ReserveFormState,
  form: FormData,
): Promise<ReserveFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await Promise.all([getTranslations("reserva"), getLocale()]);
  let monthlyAmount: string | null;
  try {
    monthlyAmount = optionalAmount(form.get("monthly"), locale);
  } catch {
    return { ok: false, message: t("errors.essential") };
  }
  return saveFund(ctx, { monthlyAmount }, t("saved.essential"));
}

/** Quanto a família separa por mês para a reserva. Não é o gasto essencial. */
export async function saveReserveContribution(
  _prev: ReserveFormState,
  form: FormData,
): Promise<ReserveFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await Promise.all([getTranslations("reserva"), getLocale()]);
  let contribution: string | null;
  try {
    contribution = optionalAmount(form.get("contribution"), locale);
  } catch {
    return { ok: false, message: t("errors.contribution") };
  }
  return saveFund(ctx, { contribution }, t("saved.contribution"));
}

const toggleSchema = z.object({ accountId: z.string().min(1), selected: z.boolean() });

/** Marca ou desmarca uma conta como parte da reserva (ADR-0007: a conta entra inteira). */
export async function toggleReserveAccount(
  accountId: string,
  selected: boolean,
): Promise<ReserveFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked();
  const t = await getTranslations("reserva.errors");
  const parsed = toggleSchema.safeParse({ accountId, selected });
  if (!parsed.success) return { ok: false, message: t("invalidAccount") };

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
  if (!changed) return { ok: false, message: t("accountGone") };
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}
