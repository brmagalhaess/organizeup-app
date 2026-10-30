"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ACCOUNT_TYPES,
  accounts,
  canWrite,
  categories,
  ENTRY_KINDS,
  withHousehold,
} from "@organizeup/db";
import { parseBRL, toDbAmount } from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface SimpleFormState {
  ok: boolean;
  message: string | null;
}

const READ_ONLY = "Seu papel nesta família não permite alterações.";

const accountSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da conta.").max(80),
  type: z.enum(ACCOUNT_TYPES),
  openingBalance: z.string().trim(),
});

export async function addAccount(_prev: SimpleFormState, form: FormData): Promise<SimpleFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: READ_ONLY };
  const parsed = accountSchema.safeParse({
    name: form.get("name") ?? "",
    type: form.get("type"),
    openingBalance: form.get("openingBalance") ?? "",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };

  let openingBalance = "0.00";
  if (parsed.data.openingBalance) {
    try {
      openingBalance = toDbAmount(parseBRL(parsed.data.openingBalance));
    } catch {
      return { ok: false, message: "Informe o saldo como 1.250,00." };
    }
  }
  await withHousehold(ctx, async (tx) => {
    const [created] = await tx
      .insert(accounts)
      .values({
        householdId: ctx.householdId,
        name: parsed.data.name,
        type: parsed.data.type,
        openingBalance,
      })
      .returning({ id: accounts.id });
    await audit(tx, ctx, "create", "accounts", created!.id);
  });
  revalidatePath("/app", "layout");
  return { ok: true, message: "Conta criada." };
}

const categorySchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da categoria.").max(60),
  kind: z.enum(ENTRY_KINDS),
  essential: z.boolean(),
});

export async function addCategory(
  _prev: SimpleFormState,
  form: FormData,
): Promise<SimpleFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: READ_ONLY };
  const parsed = categorySchema.safeParse({
    name: form.get("name") ?? "",
    kind: form.get("kind"),
    essential: form.get("essential") === "on",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };

  const created = await withHousehold(ctx, async (tx) => {
    const rows = await tx
      .insert(categories)
      .values({ householdId: ctx.householdId, ...parsed.data })
      .onConflictDoNothing()
      .returning({ id: categories.id });
    if (rows[0]) await audit(tx, ctx, "create", "categories", rows[0].id);
    return rows.length > 0;
  });
  if (!created) return { ok: false, message: "Já existe uma categoria com esse nome." };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Categoria criada." };
}
