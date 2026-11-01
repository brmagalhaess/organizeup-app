"use server";
import type { Messages } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  accountCurrency,
  canWrite,
  cardPurchases,
  cardStatementPayments,
  cashflowPlans,
  categories,
  creditCards,
  ENTRY_KINDS,
  eq,
  fxRateOn,
  inArray,
  transactions,
  withHousehold,
} from "@organizeup/db";
import {
  addMonths,
  entryFromTyped,
  FX_CURRENCIES,
  fitsAmount,
  isForeign,
  isYearMonth,
  parseMoney,
  purchaseLines,
  toDbAmount,
  yearMonthOf,
  type FxQuote,
} from "@organizeup/domain";
import { formatDate, formatMonthYear } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { audit } from "@/lib/audit";
import { confirmCommitment, goalEntryLink, reverseGoalSaved } from "@/lib/confirm-entry";
import { requireTenant } from "@/lib/session";

export interface EntryFormState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
}

/** Cotação que um lançamento nesta data usaria, para a prévia do formulário. Só lê. */
export async function quoteForEntry(currency: string, date: string): Promise<FxQuote | null> {
  const { ctx } = await requireTenant();
  const known = FX_CURRENCIES.find((code) => code === currency);
  if (!known || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return withHousehold(ctx, (tx) => fxRateOn(tx, known, date));
}

const entrySchema = (errors: Messages["lancamentos"]["errors"], locale: Locale) =>
  z.object({
    key: z.string(),
    kind: z.enum(ENTRY_KINDS, { message: errors.kind }),
    description: z.string().trim().min(1, errors.description).max(120),
    amount: z.string().transform((value, ctx) => {
      try {
        const parsed = parseMoney(value, locale);
        if (parsed.lte(0) || parsed.gte("1000000000000")) throw new RangeError("fora do limite");
        return toDbAmount(parsed);
      } catch {
        ctx.addIssue({ code: "custom", message: errors.amount });
        return z.NEVER;
      }
    }),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, errors.date)
      .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), errors.invalidDate),
    categoryId: z.string().min(1, errors.category),
    accountId: z.string().min(1, errors.account),
    done: z.boolean(),
    repeat: z.boolean(),
    installments: z.coerce
      .number({ message: errors.installments })
      .int(errors.installments)
      .min(1, errors.installments)
      .max(72, errors.installments),
  });

/** Cria um lançamento ou edita o da `key` (`t:<lançamento>` ou `p:<previsão>`). */
export async function saveEntry(_prev: EntryFormState, form: FormData): Promise<EntryFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx))
    return { ok: false, message: (await getTranslations("settings"))("noPermission") };
  const [t, locale] = await Promise.all([getTranslations("lancamentos"), getLocale()]);

  const { errors } = (await getMessages()).lancamentos;
  const parsed = entrySchema(errors, locale).safeParse({
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
    if (!category || category.kind !== data.kind) return t("errors.invalidCategory");

    if (data.accountId.startsWith("card:")) {
      if (data.kind !== "despesa") return t("errors.cardExpensesOnly");
      const cardId = data.accountId.slice(5);
      const [card] = await tx.select().from(creditCards).where(eq(creditCards.id, cardId));
      if (!card) return t("errors.invalidCard");
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
        return t("errors.statementPaid", {
          month: formatMonthYear(blocked.statementMonth, locale),
        });
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

    const currency = await accountCurrency(tx, data.accountId);
    if (!currency) return t("errors.invalidAccount");
    const foreign = isForeign(currency);
    // O valor digitado está na moeda da conta; `amount` guarda sempre reais.
    const inAccount = async () => {
      const quote = foreign ? await fxRateOn(tx, currency, data.date) : null;
      const entry = entryFromTyped(data.amount, currency, quote);
      if (!entry) return t("errors.noQuote", { currency });
      return fitsAmount(entry.amount) ? entry : t("errors.overLimit");
    };

    const common = {
      householdId: ctx.householdId,
      accountId: data.accountId,
      categoryId: data.categoryId,
      kind: data.kind,
      description: data.description,
    };
    const month = yearMonthOf(data.date);
    const noRepeat = t("errors.noRepeat");

    if (data.key.startsWith("t:")) {
      const [current] = await tx.select().from(transactions).where(eq(transactions.id, id));
      if (!current) return t("errors.notFound");
      // A previsão só some do mês do lançamento ligado a ela; trocar de mês a faria voltar.
      if (current.planId && current.planMonth !== month) return t("errors.recurringMonth");
      // A cotação fica congelada: só valor, data ou moeda novos pedem outra conversão.
      const sameMoney =
        (current.originalAmount ?? current.amount) === data.amount &&
        current.occurredOn === data.date &&
        (current.originalCurrency ?? "BRL") === currency;
      const changed = !sameMoney || current.description !== data.description;
      if (changed && (await goalEntryLink(tx, id))) return t("errors.goalEntry");
      const entry = sameMoney ? {} : await inAccount();
      if (typeof entry === "string") return entry;
      await tx
        .update(transactions)
        .set({
          ...common,
          ...entry,
          categorySource: "familia",
          occurredOn: data.date,
          status: data.done ? "realizado" : "previsto",
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, id));
      await audit(tx, ctx, "update", "transactions", id);
      return null;
    }

    if (data.key.startsWith("p:")) {
      if (foreign) return noRepeat;
      const updated = await tx
        .update(cashflowPlans)
        .set({ ...common, amount: data.amount, dayOfMonth: Number(data.date.slice(8, 10)) })
        .where(eq(cashflowPlans.id, id))
        .returning({ id: cashflowPlans.id });
      if (updated.length === 0) return t("errors.planNotFound");
      await audit(tx, ctx, "update", "cashflow_plans", id);
      return null;
    }

    if (data.repeat && foreign) return noRepeat;
    const entry = await inAccount();
    if (typeof entry === "string") return entry;

    let planId: string | null = null;
    if (data.repeat) {
      const [plan] = await tx
        .insert(cashflowPlans)
        .values({
          ...common,
          amount: data.amount,
          dayOfMonth: Number(data.date.slice(8, 10)),
          startMonth: month,
        })
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
          ...entry,
          categorySource: "familia",
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
  return { ok: true, message: t("saved") };
}

/** Marca como pago ou recebido. Null deu certo; o texto é o aviso que a tela precisa mostrar. */
export async function confirmEntryNotice(form: FormData): Promise<string | null> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return null;
  const key = String(form.get("key") ?? "");
  const month = String(form.get("month") ?? "");
  const { missingQuote } = await withHousehold(ctx, (tx) => confirmCommitment(tx, ctx, key, month));
  revalidatePath("/app", "layout");
  if (!missingQuote) return null;
  const [t, locale] = await Promise.all([getTranslations("lancamentos"), getLocale()]);
  return t("confirmNotice.text", {
    currency: missingQuote.currency,
    date: formatDate(missingQuote.date, locale),
  });
}

/** Para quem ainda usa um formulário simples, sem lugar para o aviso. */
export async function confirmEntry(form: FormData): Promise<void> {
  await confirmEntryNotice(form);
}

export async function deleteEntry(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    // Lê antes de apagar: a ligação com a parcela da meta some junto com o lançamento.
    const link = await goalEntryLink(tx, id);
    const removed = await tx
      .delete(transactions)
      .where(inArray(transactions.id, link?.transactionIds ?? [id]))
      .returning({ id: transactions.id });
    if (removed.length === 0) return;
    await audit(tx, ctx, "delete", "transactions", id);
    if (link) await reverseGoalSaved(tx, ctx, link);
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
