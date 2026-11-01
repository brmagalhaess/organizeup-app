"use server";
import { getLocale, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ASSET_KINDS, assets, canWrite, debts, eq, withHousehold } from "@organizeup/db";
import { parseMoney, toDbAmount } from "@organizeup/domain";
import type { Locale } from "@/i18n/locales";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface AssetFormState {
  ok: boolean;
  message: string | null;
}

type Errors = Awaited<ReturnType<typeof getTranslations<"patrimonio.errors">>>;

const assetSchema = (t: Errors, locale: Locale) =>
  z.object({
    id: z.string(),
    name: z.string().trim().min(1, t("name")).max(80),
    kind: z.enum(ASSET_KINDS, { message: t("kind") }),
    value: z.string().transform((value, ctx) => {
      try {
        const parsed = parseMoney(value, locale);
        if (parsed.lt(0) || parsed.gte("1000000000000")) throw new RangeError("fora do limite");
        return toDbAmount(parsed);
      } catch {
        ctx.addIssue({ code: "custom", message: t("value") });
        return z.NEVER;
      }
    }),
    valuedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, t("date"))
      .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), t("invalidDate")),
    linkedDebtId: z.string(),
  });

/** Cria um bem ou edita o do `id`. */
export async function saveAsset(_prev: AssetFormState, form: FormData): Promise<AssetFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx))
    return { ok: false, message: (await getTranslations("settings"))("noPermission") };
  const [t, saved, locale] = await Promise.all([
    getTranslations("patrimonio.errors"),
    getTranslations("patrimonio.saved"),
    getLocale(),
  ]);
  const parsed = assetSchema(t, locale).safeParse({
    id: form.get("id") ?? "",
    name: form.get("name") ?? "",
    kind: form.get("kind"),
    value: form.get("value") ?? "",
    valuedOn: form.get("valuedOn") ?? "",
    linkedDebtId: form.get("linkedDebtId") ?? "",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t("check") };
  const { id, name, kind, value, valuedOn } = parsed.data;
  const linkedDebtId = parsed.data.linkedDebtId || null;

  const failure = await withHousehold(ctx, async (tx) => {
    if (linkedDebtId) {
      const [debt] = await tx
        .select({ id: debts.id })
        .from(debts)
        .where(eq(debts.id, linkedDebtId));
      if (!debt) return t("debt");
    }
    if (id) {
      await tx
        .update(assets)
        .set({ name, kind, value, valuedOn, linkedDebtId })
        .where(eq(assets.id, id));
      await audit(tx, ctx, "update", "assets", id);
    } else {
      const [created] = await tx
        .insert(assets)
        .values({ householdId: ctx.householdId, name, kind, value, valuedOn, linkedDebtId })
        .returning({ id: assets.id });
      await audit(tx, ctx, "create", "assets", created!.id);
    }
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: id ? saved("updated") : saved("created") };
}

export async function deleteAsset(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const removed = await tx.delete(assets).where(eq(assets.id, id)).returning({ id: assets.id });
    if (removed.length > 0) await audit(tx, ctx, "delete", "assets", id);
  });
  revalidatePath("/app", "layout");
}
