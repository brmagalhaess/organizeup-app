"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, canWrite, categories, ENTRY_KINDS, eq, withHousehold } from "@organizeup/db";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface CategoryFormState {
  ok: boolean;
  message: string | null;
}

const categorySchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1, "Informe o nome da categoria.").max(60),
  kind: z.enum(ENTRY_KINDS),
  essential: z.boolean(),
});

/** Cria uma categoria ou edita a do `id`. */
export async function saveCategory(
  _prev: CategoryFormState,
  form: FormData,
): Promise<CategoryFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx))
    return { ok: false, message: "Seu papel nesta família não permite alterações." };
  const parsed = categorySchema.safeParse({
    id: form.get("id") ?? "",
    name: form.get("name") ?? "",
    kind: form.get("kind"),
    essential: form.get("essential") === "on",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };
  const { id, name, kind, essential } = parsed.data;

  const failure = await withHousehold(ctx, async (tx) => {
    const [same] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.kind, kind), eq(categories.name, name)));
    if (same && same.id !== id) return "Já existe uma categoria com esse nome.";
    if (id) {
      // O tipo não muda: lançamentos da categoria dependem dele.
      await tx.update(categories).set({ name, essential }).where(eq(categories.id, id));
      await audit(tx, ctx, "update", "categories", id);
    } else {
      const [created] = await tx
        .insert(categories)
        .values({ householdId: ctx.householdId, name, kind, essential })
        .returning({ id: categories.id });
      await audit(tx, ctx, "create", "categories", created!.id);
    }
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: id ? "Categoria salva." : "Categoria criada." };
}

/** Arquiva ou reativa. A categoria some dos formulários; o histórico continua. */
export async function setCategoryArchived(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  const archived = form.get("archived") === "true";
  await withHousehold(ctx, async (tx) => {
    await tx.update(categories).set({ archived }).where(eq(categories.id, id));
    await audit(tx, ctx, archived ? "archive" : "restore", "categories", id);
  });
  revalidatePath("/app", "layout");
}
