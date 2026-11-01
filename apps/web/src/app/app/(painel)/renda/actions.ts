"use server";
import type { Messages } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
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
  parseMoney,
  toDbAmount,
  todayIn,
  yearMonthOf,
} from "@organizeup/domain";
import type { Locale } from "@/i18n/locales";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface IncomeFormState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
}

const LIMIT = "1000000000000";

const amountField = (message: string, locale: Locale, optional = false) =>
  z.string().transform((value, ctx) => {
    if (optional && !value.trim()) return "0.00";
    try {
      const parsed = parseMoney(value, locale);
      if (parsed.lt(0) || parsed.gte(LIMIT) || (!optional && parsed.isZero()))
        throw new RangeError("fora do limite");
      return toDbAmount(parsed);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });

const schema = (errors: Messages["renda"]["errors"], locale: Locale) =>
  z.object({
    id: z.string(),
    name: z.string().trim().min(1, errors.name).max(80),
    kind: z.enum(INCOME_KINDS, { message: errors.kind }),
    amount: amountField(errors.amount, locale),
    dependents: z.coerce
      .number({ message: errors.dependents })
      .int(errors.dependents)
      .min(0, errors.dependents)
      .max(20, errors.dependents),
    pensionAmount: amountField(errors.pension, locale, true),
    otherDiscounts: amountField(errors.otherDiscounts, locale, true),
    vacationMonth: z.coerce.number().int().min(0).max(12),
    payDay: z.coerce
      .number({ message: errors.payDay })
      .int(errors.payDay)
      .min(1, errors.payDay)
      .max(31, errors.payDay),
    accountId: z.string().min(1, errors.account),
    categoryId: z.string().min(1, errors.category),
    personId: z.string(),
  });

/** Cria uma renda ou edita a do `id`. Só a CLT é calculada pelo bruto. */
export async function saveIncome(_prev: IncomeFormState, form: FormData): Promise<IncomeFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx))
    return { ok: false, message: (await getTranslations("settings"))("noPermission") };
  const [t, locale, messages] = await Promise.all([
    getTranslations("renda"),
    getLocale(),
    getMessages(),
  ]);
  const parsed = schema(messages.renda.errors, locale).safeParse({
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
    if (!account) return t("errors.invalidAccount");
    const [category] = await tx
      .select({ kind: categories.kind })
      .from(categories)
      .where(eq(categories.id, data.categoryId));
    if (category?.kind !== "receita") return t("errors.incomeCategory");
    if (values.personId) {
      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        .where(eq(people.id, values.personId));
      if (!person) return t("errors.invalidPerson");
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
  return { ok: true, message: t("saved") };
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
