"use server";
import { getLocale, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordDividendRemoval, syncMarketData } from "@organizeup/agents";
import {
  canWrite,
  DIVIDEND_KINDS,
  dividendGoals,
  dividends,
  eq,
  householdCurrency,
  householdTimezone,
  investments,
  withHousehold,
} from "@organizeup/db";
import { money, parseMoney, toDbAmount, todayIn } from "@organizeup/domain";
import type { Locale } from "@/i18n/locales";
import { audit } from "@/lib/audit";
import { requireModule } from "@/lib/billing/plan-gate";
import { queueMarketDataJob } from "@/lib/market-queue";
import { moneyTextFor } from "@/i18n/format";

export interface FormState {
  ok: boolean;
  message: string | null;
}

type Errors = Awaited<ReturnType<typeof getTranslations<"proventos.errors">>>;

const blocked = async (): Promise<FormState> => ({
  ok: false,
  message: (await getTranslations("settings"))("noPermission"),
});

const amount = (message: string, locale: Locale) =>
  z.string().transform((value, ctx) => {
    try {
      const parsed = parseMoney(value, locale);
      if (parsed.lt(0) || parsed.gte("1000000000000")) throw new RangeError("fora do limite");
      return toDbAmount(parsed);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });

const dividendSchema = (t: Errors, locale: Locale) =>
  z.object({
    investmentId: z.string().min(1, t("investmentRequired")),
    kind: z.enum(DIVIDEND_KINDS, { message: t("kindRequired") }),
    paidOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, t("dateRequired"))
      .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), t("dateInvalid")),
    gross: amount(t("grossFormat"), locale),
    withheld: amount(t("withheldFormat"), locale),
  });

export async function addDividend(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireModule("investimentos");
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await Promise.all([getTranslations("proventos.errors"), getLocale()]);
  const parsed = dividendSchema(t, locale).safeParse({
    investmentId: form.get("investmentId") ?? "",
    kind: form.get("kind"),
    paidOn: form.get("paidOn") ?? "",
    gross: form.get("gross") ?? "",
    withheld: form.get("withheld") || "0",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t("check") };
  if (money(parsed.data.gross).isZero()) return { ok: false, message: t("grossRequired") };
  if (money(parsed.data.withheld).gt(parsed.data.gross))
    return { ok: false, message: t("withheldTooHigh") };

  const failure = await withHousehold(ctx, async (tx) => {
    const [investment] = await tx
      .select({ id: investments.id })
      .from(investments)
      .where(eq(investments.id, parsed.data.investmentId));
    if (!investment) return t("investmentInvalid");
    const [created] = await tx
      .insert(dividends)
      .values({ householdId: ctx.householdId, ...parsed.data })
      .returning({ id: dividends.id });
    await audit(tx, ctx, "create", "dividends", created!.id);
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}

export async function deleteDividend(form: FormData): Promise<void> {
  const { ctx } = await requireModule("investimentos");
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const [removed] = await tx.delete(dividends).where(eq(dividends.id, id)).returning({
      id: dividends.id,
      investmentId: dividends.investmentId,
      marketDividendId: dividends.marketDividendId,
    });
    if (!removed) return;
    await audit(tx, ctx, "delete", "dividends", id);
    // Provento automático excluído não volta na próxima rodada (ADR-0017).
    if (removed.marketDividendId) {
      await recordDividendRemoval(tx, ctx, {
        dividendId: removed.id,
        investmentId: removed.investmentId,
        marketDividendId: removed.marketDividendId,
      });
    }
  });
  revalidatePath("/app", "layout");
}

/** Meta de renda mensal com proventos. Campo vazio tira a meta. */
export async function saveGoal(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireModule("investimentos");
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await Promise.all([getTranslations("proventos.errors"), getLocale()]);
  const raw = String(form.get("monthlyAmount") ?? "").trim();
  const parsed = amount(t("goalFormat"), locale).safeParse(raw || "0");
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t("check") };
  await withHousehold(ctx, async (tx) => {
    if (money(parsed.data).isZero()) {
      await tx.delete(dividendGoals).where(eq(dividendGoals.householdId, ctx.householdId));
    } else {
      await tx
        .insert(dividendGoals)
        .values({ householdId: ctx.householdId, monthlyAmount: parsed.data })
        .onConflictDoUpdate({
          target: dividendGoals.householdId,
          set: { monthlyAmount: parsed.data, updatedAt: new Date() },
        });
    }
    await audit(tx, ctx, "update", "dividend_goals", ctx.householdId);
  });
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}

/**
 * "Ver proventos": concilia agora a carteira com o que o mercado já trouxe, inclusive meses passados em que a
 * família já tinha o ativo, e pede ao worker uma coleta nova para o que ainda não foi consultado. A mesma
 * rotina do agente diário, só que na hora (ADR-0017).
 */
export async function checkDividends(_prev: FormState, _form: FormData): Promise<FormState> {
  const { ctx } = await requireModule("investimentos");
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await Promise.all([getTranslations("proventos.check"), getLocale()]);
  const { result, currency } = await withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const synced = await syncMarketData(tx, { today, householdId: ctx.householdId });
    await audit(tx, ctx, "sync", "dividends", ctx.householdId);
    return { result: synced, currency: await householdCurrency(tx) };
  });
  const moneyText = moneyTextFor(locale, currency);
  const queued = await queueMarketDataJob();
  revalidatePath("/app", "layout");
  const message =
    result.created > 0
      ? t("created", {
          count: result.created,
          upcoming: result.upcoming,
          amount: moneyText(result.upcomingNet),
        })
      : t("nothing");
  return { ok: true, message: queued ? `${message} ${t("queued")}` : message };
}
