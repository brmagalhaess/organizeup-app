"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ACCOUNT_TYPES, accounts, and, canWrite, eq, withHousehold } from "@organizeup/db";
import { parseBRL, toDbAmount } from "@organizeup/domain";
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
  openingBalance: z.string().trim(),
});

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
    openingBalance: form.get("openingBalance") ?? "",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };

  const { id, name, type } = parsed.data;
  let openingBalance = "0.00";
  if (parsed.data.openingBalance) {
    try {
      openingBalance = toDbAmount(parseBRL(parsed.data.openingBalance));
    } catch {
      return { ok: false, message: "Informe o saldo como 1.250,00." };
    }
  }
  await withHousehold(ctx, async (tx) => {
    if (id) {
      await tx.update(accounts).set({ name, type, openingBalance }).where(eq(accounts.id, id));
      await audit(tx, ctx, "update", "accounts", id);
    } else {
      const [created] = await tx
        .insert(accounts)
        .values({ householdId: ctx.householdId, name, type, openingBalance })
        .returning({ id: accounts.id });
      await audit(tx, ctx, "create", "accounts", created!.id);
    }
  });
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
