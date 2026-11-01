"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ACCOUNT_TYPES,
  accounts,
  accountsWithMovement,
  accountTransfers,
  and,
  canWrite,
  eq,
  inArray,
  withHousehold,
} from "@organizeup/db";
import {
  CURRENCIES,
  currencySymbol,
  fitsAmount,
  parseBRL,
  toDbAmount,
  transferRate,
} from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface SimpleFormState {
  ok: boolean;
  message: string | null;
}

const READ_ONLY = "Seu papel nesta família não permite alterações.";

const accountSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1, "Informe o nome da conta.").max(80),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.enum(CURRENCIES, { message: "Escolha a moeda." }),
  openingBalance: z.string().trim(),
});

const transferSchema = z
  .object({
    fromAccountId: z.string().min(1, "Escolha a conta de origem."),
    toAccountId: z.string().min(1, "Escolha a conta de destino."),
    amount: z.string().trim().min(1, "Informe o valor."),
    toAmount: z.string().trim(),
    occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data."),
    note: z.string().trim().max(120),
  })
  .refine((data) => data.fromAccountId !== data.toAccountId, {
    message: "Escolha duas contas diferentes.",
  });

/** Move dinheiro entre duas contas. Não é receita nem despesa: não entra nos resumos do mês. */
export async function createTransfer(
  _previous: SimpleFormState,
  form: FormData,
): Promise<SimpleFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: READ_ONLY };
  const parsed = transferSchema.safeParse({
    fromAccountId: form.get("fromAccountId") ?? "",
    toAccountId: form.get("toAccountId") ?? "",
    amount: form.get("amount") ?? "",
    toAmount: form.get("toAmount") ?? "",
    occurredOn: form.get("occurredOn") ?? "",
    note: form.get("note") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique os dados." };
  }
  const { amount: raw, toAmount: rawTo, note, ...values } = parsed.data;
  let amount: string;
  try {
    const value = parseBRL(raw);
    if (value.lte(0)) throw new RangeError("valor");
    if (!fitsAmount(value)) throw new RangeError("valor");
    amount = toDbAmount(value);
  } catch {
    return { ok: false, message: "Informe o valor como 500,00." };
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
    if (found.length !== 2) return "Uma das contas não existe mais.";
    const from = found.find((account) => account.id === values.fromAccountId)!.currency;
    const to = found.find((account) => account.id === values.toAccountId)!.currency;
    // Entre moedas, as duas pontas são o que aconteceu de fato: a taxa sai delas, não da PTAX.
    let exchange: { toAmount: string; fxRate: string } | null = null;
    if (from !== to) {
      const invalid = `Informe quanto entrou em ${currencySymbol(to)}, como 500,00.`;
      let toAmount: string;
      try {
        const value = parseBRL(rawTo);
        if (value.lte(0) || !fitsAmount(value)) return invalid;
        toAmount = toDbAmount(value);
      } catch {
        return invalid;
      }
      const fxRate = transferRate(amount, from, toAmount);
      if (!fxRate) return "Confira os dois valores: a taxa ficou fora do comum.";
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
  if (!canWrite(ctx)) return { ok: false, message: READ_ONLY };
  const parsed = accountSchema.safeParse({
    id: form.get("id") ?? "",
    name: form.get("name") ?? "",
    type: form.get("type"),
    currency: form.get("currency") ?? "BRL",
    openingBalance: form.get("openingBalance") ?? "",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };

  const { id, name, type, currency } = parsed.data;
  let openingBalance = "0.00";
  if (parsed.data.openingBalance) {
    try {
      openingBalance = toDbAmount(parseBRL(parsed.data.openingBalance));
    } catch {
      return { ok: false, message: "Informe o saldo como 1.250,00." };
    }
  }
  const failure = await withHousehold(ctx, async (tx) => {
    if (id) {
      const [current] = await tx
        .select({ currency: accounts.currency })
        .from(accounts)
        .where(eq(accounts.id, id));
      if (current && current.currency !== currency && (await accountsWithMovement(tx)).has(id))
        return "Esta conta já tem movimento e não pode mudar de moeda. Crie outra conta.";
      await tx
        .update(accounts)
        .set({ name, type, currency, openingBalance })
        .where(eq(accounts.id, id));
      await audit(tx, ctx, "update", "accounts", id);
    } else {
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
  return { ok: true, message: id ? "Conta salva." : "Conta criada." };
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
