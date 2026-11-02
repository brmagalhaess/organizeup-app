"use server";
import type { Messages } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ACCOUNT_TYPES,
  accounts,
  accountsWithMovement,
  accountTransfers,
  and,
  canWrite,
  currencyFrozen,
  eq,
  inArray,
  withHousehold,
} from "@organizeup/db";
import {
  CURRENCIES,
  currencySymbol,
  fitsAmount,
  parseMoney,
  toDbAmount,
  transferRate,
} from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";
import { systemTextOf } from "@/i18n/system-text";

export interface SimpleFormState {
  ok: boolean;
  message: string | null;
}

type Errors = Messages["contas"]["errors"];

const readOnly = async () => (await getTranslations("settings"))("noPermission");

const accountSchema = (errors: Errors) =>
  z.object({
    id: z.string(),
    name: z.string().trim().min(1, errors.name).max(80),
    type: z.enum(ACCOUNT_TYPES),
    currency: z.enum(CURRENCIES, { message: errors.currency }),
    openingBalance: z.string().trim(),
  });

const transferSchema = (errors: Errors) =>
  z
    .object({
      fromAccountId: z.string().min(1, errors.from),
      toAccountId: z.string().min(1, errors.to),
      amount: z.string().trim().min(1, errors.amount),
      toAmount: z.string().trim(),
      occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, errors.date),
      note: z.string().trim().max(120),
    })
    .refine((data) => data.fromAccountId !== data.toAccountId, {
      message: errors.sameAccount,
    });

/** Move dinheiro entre duas contas. Não é receita nem despesa: não entra nos resumos do mês. */
export async function createTransfer(
  _previous: SimpleFormState,
  form: FormData,
): Promise<SimpleFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: await readOnly() };
  const [t, locale, messages] = await Promise.all([
    getTranslations("contas.errors"),
    getLocale(),
    getMessages(),
  ]);
  const parsed = transferSchema(messages.contas.errors).safeParse({
    fromAccountId: form.get("fromAccountId") ?? "",
    toAccountId: form.get("toAccountId") ?? "",
    amount: form.get("amount") ?? "",
    toAmount: form.get("toAmount") ?? "",
    occurredOn: form.get("occurredOn") ?? "",
    note: form.get("note") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? t("checkData") };
  }
  const { amount: raw, toAmount: rawTo, note, ...values } = parsed.data;
  let amount: string;
  try {
    const value = parseMoney(raw, locale);
    if (value.lte(0)) throw new RangeError("valor");
    if (!fitsAmount(value)) throw new RangeError("valor");
    amount = toDbAmount(value);
  } catch {
    return { ok: false, message: t("amountFormat") };
  }
  const failure = await withHousehold(ctx, async (tx) => {
    const found = await tx
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .where(
        and(
          inArray(accounts.id, [values.fromAccountId, values.toAccountId]),
          eq(accounts.archived, false),
        ),
      );
    if (found.length !== 2) return t("accountGone");
    const from = found.find((account) => account.id === values.fromAccountId)!.currency;
    const to = found.find((account) => account.id === values.toAccountId)!.currency;
    // Moeda adicional cancelada: a conta fica, só leitura.
    for (const currency of [from, to]) {
      if (await currencyFrozen(tx, currency)) return t("currencyOff", { currency });
    }
    // Entre moedas, as duas pontas são o que aconteceu de fato: a taxa sai delas, não da PTAX.
    let exchange: { toAmount: string; fxRate: string } | null = null;
    if (from !== to) {
      const invalid = t("enteredFormat", { symbol: currencySymbol(to) });
      let toAmount: string;
      try {
        const value = parseMoney(rawTo, locale);
        if (value.lte(0) || !fitsAmount(value)) return invalid;
        toAmount = toDbAmount(value);
      } catch {
        return invalid;
      }
      const fxRate = transferRate(amount, from, toAmount);
      if (!fxRate) return t("oddRate");
      exchange = { toAmount, fxRate };
    }
    const [created] = await tx
      .insert(accountTransfers)
      .values({
        householdId: ctx.householdId,
        ...values,
        amount,
        ...exchange,
        note: note || null,
        createdBy: ctx.userId,
      })
      .returning({ id: accountTransfers.id });
    await audit(tx, ctx, "create", "account_transfers", created!.id);
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}

export async function deleteTransfer(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const removed = await tx
      .delete(accountTransfers)
      .where(eq(accountTransfers.id, id))
      .returning({ id: accountTransfers.id });
    if (removed.length > 0) await audit(tx, ctx, "delete", "account_transfers", id);
  });
  revalidatePath("/app", "layout");
}

/** Cria uma conta ou edita a do `id`. */
export async function saveAccount(
  _prev: SimpleFormState,
  form: FormData,
): Promise<SimpleFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: await readOnly() };
  const [t, locale, messages] = await Promise.all([
    getTranslations("contas"),
    getLocale(),
    getMessages(),
  ]);
  const parsed = accountSchema(messages.contas.errors).safeParse({
    id: form.get("id") ?? "",
    name: form.get("name") ?? "",
    type: form.get("type"),
    currency: form.get("currency") ?? "BRL",
    openingBalance: form.get("openingBalance") ?? "",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? t("errors.check") };

  const { id, name, type, currency } = parsed.data;
  let openingBalance = "0.00";
  if (parsed.data.openingBalance) {
    try {
      openingBalance = toDbAmount(parseMoney(parsed.data.openingBalance, locale));
    } catch {
      return { ok: false, message: t("errors.balanceFormat") };
    }
  }
  const system = systemTextOf(await getTranslations("sistema"));
  const failure = await withHousehold(ctx, async (tx) => {
    if (id) {
      const [current] = await tx
        .select({ currency: accounts.currency, name: accounts.name })
        .from(accounts)
        .where(eq(accounts.id, id));
      if (current && current.currency !== currency && (await accountsWithMovement(tx)).has(id))
        return t("errors.currencyLocked");
      // Trocar a moeda é abrir conta nela: vale a mesma regra de criar.
      if (current && current.currency !== currency && (await currencyFrozen(tx, currency))) {
        return t("errors.currencyOff", { currency });
      }
      // O formulário mostra o nome padrão traduzido: sem mudança, o gravado fica como estava.
      const kept = current && system.name(current.name) === name ? current.name : name;
      await tx
        .update(accounts)
        .set({ name: kept, type, currency, openingBalance })
        .where(eq(accounts.id, id));
      await audit(tx, ctx, "update", "accounts", id);
    } else {
      // Só a moeda assinada libera conta nova nela.
      if (await currencyFrozen(tx, currency)) return t("errors.currencyOff", { currency });
      const [created] = await tx
        .insert(accounts)
        .values({ householdId: ctx.householdId, name, type, currency, openingBalance })
        .returning({ id: accounts.id });
      await audit(tx, ctx, "create", "accounts", created!.id);
    }
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: t(id ? "saved" : "created") };
}

/** Arquiva ou reativa. A conta some dos formulários; o histórico continua. */
export async function setAccountArchived(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  const archived = form.get("archived") === "true";
  await withHousehold(ctx, async (tx) => {
    if (archived) {
      // Sem conta ativa não há onde lançar.
      const others = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.archived, false)));
      if (others.filter((account) => account.id !== id).length === 0) return;
    }
    await tx.update(accounts).set({ archived }).where(eq(accounts.id, id));
    await audit(tx, ctx, archived ? "archive" : "restore", "accounts", id);
  });
  revalidatePath("/app", "layout");
}
