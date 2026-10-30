"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ASSET_KINDS, assets, canWrite, debts, eq, withHousehold } from "@organizeup/db";
import { parseBRL, toDbAmount } from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface AssetFormState {
  ok: boolean;
  message: string | null;
}

const schema = z.object({
  id: z.string(),
  name: z.string().trim().min(1, "Informe o nome do bem.").max(80),
  kind: z.enum(ASSET_KINDS, { message: "Escolha o tipo." }),
  value: z.string().transform((value, ctx) => {
    try {
      const parsed = parseBRL(value);
      if (parsed.lt(0) || parsed.gte("1000000000000")) throw new RangeError("fora do limite");
      return toDbAmount(parsed);
    } catch {
      ctx.addIssue({ code: "custom", message: "Informe o valor como 350.000,00." });
      return z.NEVER;
    }
  }),
  valuedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do valor.")
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Data inválida."),
  linkedDebtId: z.string(),
});

/** Cria um bem ou edita o do `id`. */
export async function saveAsset(_prev: AssetFormState, form: FormData): Promise<AssetFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx))
    return { ok: false, message: "Seu papel nesta família não permite alterações." };
  const parsed = schema.safeParse({
    id: form.get("id") ?? "",
    name: form.get("name") ?? "",
    kind: form.get("kind"),
    value: form.get("value") ?? "",
    valuedOn: form.get("valuedOn") ?? "",
    linkedDebtId: form.get("linkedDebtId") ?? "",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };
  const { id, name, kind, value, valuedOn } = parsed.data;
  const linkedDebtId = parsed.data.linkedDebtId || null;

  const failure = await withHousehold(ctx, async (tx) => {
    if (linkedDebtId) {
      const [debt] = await tx
        .select({ id: debts.id })
        .from(debts)
        .where(eq(debts.id, linkedDebtId));
      if (!debt) return "Escolha uma dívida válida.";
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
  return { ok: true, message: id ? "Bem salvo." : "Bem criado." };
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
