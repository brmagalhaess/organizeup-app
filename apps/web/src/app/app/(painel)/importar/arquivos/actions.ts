"use server";
// Importador inteligente (ADR-0030). A tela nunca decide nada: tudo aqui reconfere papel, e a aprovação
// reconfere cada item. Só `owner` e `adult` escrevem; a RLS repete a regra.
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  deleteSmartImport,
  queueSmartImport,
  requeueSmartFile,
  touchSmartImport,
} from "@organizeup/agents";
import { acceptImporterFiles, canUseAssistant } from "@organizeup/ai";
import {
  accounts,
  and,
  canWrite,
  categories,
  creditCards,
  eq,
  householdTimezone,
  ne,
  smartImportFiles,
  smartImportItems,
  smartImports,
  withHousehold,
} from "@organizeup/db";
import { mergeSmartEdit, SMART_REQUEUE_MS, todayIn, type SmartRawFields } from "@organizeup/domain";
import { approveSmartImport, type SmartApproval } from "@/lib/importador/commit";
import { queueSmartImportJob } from "@/lib/importador/queue";
import { LEGAL_VERSION } from "@/lib/legal";
import { requireTenant } from "@/lib/session";

const PATH = "/app/importar/arquivos";
const refresh = () => revalidatePath(PATH, "layout");

export type ActionResult = { ok: true } | { ok: false; message: string };

const noPermission = async () => (await getTranslations("importador.errors"))("noPermission");

/** Aceite que cobre qualquer arquivo. Fica gravada a versão dos textos de agora. */
export async function acceptImporter(): Promise<ActionResult> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx) || !canUseAssistant(ctx)) return { ok: false, message: await noPermission() };
  await acceptImporterFiles(ctx, LEGAL_VERSION);
  refresh();
  return { ok: true };
}

/** Fecha o envio e chama o worker. Se o aviso falhar, o lote fica na fila e a tela pede de novo. */
export async function startImport(importId: string, useAi: boolean): Promise<ActionResult> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: await noPermission() };
  const queued = await withHousehold(ctx, (tx) => queueSmartImport(tx, ctx, importId, useAi));
  if (!queued) {
    return { ok: false, message: (await getTranslations("importador.errors"))("notStarted") };
  }
  await queueSmartImportJob({ householdId: ctx.householdId, importId });
  refresh();
  return { ok: true };
}

/** A tela olha o lote parado. Na fila há tempo demais: repete o aviso. */
export async function nudgeImport(importId: string): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const stale = await withHousehold(ctx, async (tx) => {
    const [lot] = await tx
      .select({ status: smartImports.status, queuedAt: smartImports.queuedAt })
      .from(smartImports)
      .where(eq(smartImports.id, importId));
    if (!lot?.queuedAt || (lot.status !== "na_fila" && lot.status !== "lendo")) return false;
    if (Date.now() - lot.queuedAt.getTime() < SMART_REQUEUE_MS) return false;
    await touchSmartImport(tx, importId);
    return true;
  });
  if (stale) await queueSmartImportJob({ householdId: ctx.householdId, importId });
}

export async function reprocessFile(fileId: string): Promise<ActionResult> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: await noPermission() };
  const importId = await withHousehold(ctx, (tx) => requeueSmartFile(tx, ctx, fileId));
  if (!importId) {
    return { ok: false, message: (await getTranslations("importador.errors"))("notFound") };
  }
  await queueSmartImportJob({ householdId: ctx.householdId, importId });
  refresh();
  return { ok: true };
}

export async function removeImport(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  await withHousehold(ctx, (tx) => deleteSmartImport(tx, ctx, String(form.get("id") ?? "")));
  refresh();
}

export async function toggleItems(
  importId: string,
  ids: string[],
  selected: boolean,
): Promise<ActionResult> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: await noPermission() };
  await withHousehold(ctx, async (tx) => {
    for (const id of ids.slice(0, 2500)) {
      await tx
        .update(smartImportItems)
        .set({ selected, updatedAt: new Date() })
        .where(
          and(
            eq(smartImportItems.id, id),
            eq(smartImportItems.importId, importId),
            ne(smartImportItems.status, "gravado"),
          ),
        );
    }
  });
  refresh();
  return { ok: true };
}

const targetSchema = z.object({
  fileId: z.string().min(1).max(100),
  accountId: z.string().max(100),
  cardId: z.string().max(100),
});

/** Conta e cartão do arquivo: valem para todo item sem escolha própria. */
export async function setFileTarget(input: z.input<typeof targetSchema>): Promise<ActionResult> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: await noPermission() };
  const t = await getTranslations("importador.errors");
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: t("invalid") };
  const { fileId, accountId, cardId } = parsed.data;
  const done = await withHousehold(ctx, async (tx) => {
    if (accountId) {
      const [row] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, accountId));
      if (!row) return false;
    }
    if (cardId) {
      const [row] = await tx
        .select({ id: creditCards.id })
        .from(creditCards)
        .where(eq(creditCards.id, cardId));
      if (!row) return false;
    }
    await tx
      .update(smartImportFiles)
      .set({ accountId: accountId || null, cardId: cardId || null, updatedAt: new Date() })
      .where(eq(smartImportFiles.id, fileId));
    return true;
  });
  if (!done) return { ok: false, message: t("invalid") };
  refresh();
  return { ok: true };
}

const MAX_FIELD = 200;
const editSchema = z.object({
  id: z.string().min(1).max(100),
  fields: z.record(z.string().max(40), z.string().max(MAX_FIELD)),
  categoryId: z.string().max(100).nullable(),
});

/** Salva a edição de um item. O que a pessoa digitou passa pelas mesmas conferências do que veio do arquivo. */
export async function saveItem(input: z.input<typeof editSchema>): Promise<ActionResult> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: await noPermission() };
  const t = await getTranslations("importador.errors");
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: t("invalid") };
  const { id, fields, categoryId } = parsed.data;
  return withHousehold(ctx, async (tx) => {
    const [item] = await tx
      .select()
      .from(smartImportItems)
      .where(eq(smartImportItems.id, id))
      .for("update");
    if (!item || item.status === "gravado") return { ok: false as const, message: t("notFound") };
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const next = mergeSmartEdit(item.payload, fields as SmartRawFields, today);
    if (categoryId && "categoryId" in next) {
      const [category] = await tx
        .select({ kind: categories.kind })
        .from(categories)
        .where(eq(categories.id, categoryId));
      if (!category) return { ok: false as const, message: t("invalid") };
      // Escolha da pessoa: é o que protege a categoria do agente diário.
      next.categoryId = categoryId;
      next.newCategory = null;
      next.categorySource = null;
    }
    await tx
      .update(smartImportItems)
      .set({ payload: next, status: "proposto", failure: null, updatedAt: new Date() })
      .where(eq(smartImportItems.id, id));
    refresh();
    return { ok: true as const };
  });
}

export async function approveImport(importId: string): Promise<SmartApproval> {
  const { ctx } = await requireTenant();
  const result = await approveSmartImport(ctx, importId);
  refresh();
  revalidatePath("/app", "layout");
  return result;
}
