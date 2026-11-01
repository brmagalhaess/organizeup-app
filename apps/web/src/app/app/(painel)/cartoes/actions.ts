"use server";
import type { Messages } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  accounts,
  canWrite,
  cardPurchases,
  cardStatementPayments,
  creditCards,
  eq,
  withHousehold,
} from "@organizeup/db";
import { parseMoney, purchaseLines, toDbAmount } from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface CardFormState {
  ok: boolean;
  message: string | null;
}

const dayOfMonth = (missing: string, range: string) =>
  z.coerce.number({ message: missing }).int(missing).min(1, range).max(31, range);

const cardSchema = (errors: Messages["cartoes"]["errors"]) =>
  z.object({
    id: z.string(),
    name: z.string().trim().min(1, errors.name).max(80),
    limit: z.string().trim(),
    closingDay: dayOfMonth(errors.closingDay, errors.closingDayRange),
    dueDay: dayOfMonth(errors.dueDay, errors.dueDayRange),
    payingAccountId: z.string().min(1, errors.payingAccount),
  });

/** Cria um cartão ou edita o do `id`. */
export async function saveCard(_prev: CardFormState, form: FormData): Promise<CardFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx))
    return { ok: false, message: (await getTranslations("settings"))("noPermission") };
  const [t, locale, messages] = await Promise.all([
    getTranslations("cartoes"),
    getLocale(),
    getMessages(),
  ]);
  const parsed = cardSchema(messages.cartoes.errors).safeParse({
    id: form.get("id") ?? "",
    name: form.get("name") ?? "",
    limit: form.get("limit") ?? "",
    closingDay: form.get("closingDay"),
    dueDay: form.get("dueDay"),
    payingAccountId: form.get("payingAccountId") ?? "",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? t("errors.check") };
  const { id, name, closingDay, dueDay, payingAccountId } = parsed.data;

  let limitAmount: string | null = null;
  if (parsed.data.limit) {
    try {
      const value = parseMoney(parsed.data.limit, locale);
      if (value.lt(0)) throw new RangeError("negativo");
      limitAmount = toDbAmount(value);
    } catch {
      return { ok: false, message: t("errors.limit") };
    }
  }

  const failure = await withHousehold(ctx, async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, payingAccountId));
    if (!account) return t("errors.invalidAccount");

    if (!id) {
      const [created] = await tx
        .insert(creditCards)
        .values({
          householdId: ctx.householdId,
          name,
          limitAmount,
          closingDay,
          dueDay,
          payingAccountId,
        })
        .returning({ id: creditCards.id });
      await audit(tx, ctx, "create", "credit_cards", created!.id);
      return null;
    }

    const [current] = await tx.select().from(creditCards).where(eq(creditCards.id, id));
    if (!current) return t("errors.notFound");
    // As faturas são calculadas pelas datas: mudá-las moveria compras de faturas já pagas.
    if (current.closingDay !== closingDay || current.dueDay !== dueDay) {
      const paid = await tx
        .select({ id: cardStatementPayments.id })
        .from(cardStatementPayments)
        .where(eq(cardStatementPayments.cardId, id))
        .limit(1);
      if (paid.length > 0) return t("errors.datesLocked");
    }
    await tx
      .update(creditCards)
      .set({ name, limitAmount, closingDay, dueDay, payingAccountId })
      .where(eq(creditCards.id, id));
    await audit(tx, ctx, "update", "credit_cards", id);
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: t(id ? "saved" : "created") };
}

/** Arquiva ou reativa. Faturas em aberto continuam até serem pagas. */
export async function setCardArchived(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  const archived = form.get("archived") === "true";
  await withHousehold(ctx, async (tx) => {
    await tx.update(creditCards).set({ archived }).where(eq(creditCards.id, id));
    await audit(tx, ctx, archived ? "archive" : "restore", "credit_cards", id);
  });
  revalidatePath("/app", "layout");
}

/** Apaga a compra e todas as parcelas, se nenhuma estiver em fatura paga. */
export async function deletePurchase(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const [purchase] = await tx.select().from(cardPurchases).where(eq(cardPurchases.id, id));
    if (!purchase) return;
    const [card] = await tx.select().from(creditCards).where(eq(creditCards.id, purchase.cardId));
    if (!card) return;
    const paid = await tx
      .select({ month: cardStatementPayments.statementMonth })
      .from(cardStatementPayments)
      .where(eq(cardStatementPayments.cardId, card.id));
    const months = new Set(paid.map((row) => row.month));
    if (purchaseLines(purchase, card).some((line) => months.has(line.statementMonth))) return;
    await tx.delete(cardPurchases).where(eq(cardPurchases.id, id));
    await audit(tx, ctx, "delete", "card_purchases", id);
  });
  revalidatePath("/app", "layout");
}
