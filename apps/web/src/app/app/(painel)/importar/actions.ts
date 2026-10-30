"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  accounts,
  and,
  canWrite,
  cashflowPlans,
  categories,
  desc,
  eq,
  gte,
  IMPORT_SOURCES,
  importBatches,
  inArray,
  lte,
  transactions,
  withHousehold,
} from "@organizeup/db";
import {
  addMonths,
  buildMonthEntries,
  CARD_CATEGORY,
  monthBounds,
  normalizeDescription,
  reconcileRows,
  suggestCategory,
  withFingerprints,
  yearMonthOf,
  type KnownEntry,
  type ReconciledRow,
} from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { loadCommitments } from "@/lib/commitments";
import { confirmCommitment } from "@/lib/confirm-entry";
import { requireTenant } from "@/lib/session";

const READ_ONLY = "Seu papel nesta família não permite alterações.";
export type PreparedRow = ReconciledRow & { categoryId: string | null };

const MAX_ROWS = 2000;
const baseRow = {
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(1).max(120),
  amount: z.string().regex(/^\d{1,12}\.\d{2}$/),
  kind: z.enum(["receita", "despesa"]),
};
const prepareSchema = z.object({
  accountId: z.string().min(1),
  source: z.enum(IMPORT_SOURCES),
  rows: z
    .array(z.object({ ...baseRow, externalId: z.string().max(200).optional() }))
    .min(1)
    .max(MAX_ROWS),
});
const commitSchema = z.object({
  accountId: z.string().min(1),
  source: z.enum(IMPORT_SOURCES),
  rows: z
    .array(
      z.object({
        ...baseRow,
        fingerprint: z.string().min(1).max(300),
        categoryId: z.string().min(1),
        matchKey: z.string().max(200).nullable(),
        matchMonth: z.string().max(7).nullable(),
      }),
    )
    .min(1)
    .max(MAX_ROWS),
});

/** Compara o extrato com o que já existe. Não grava nada. */
export async function prepareImport(
  input: z.input<typeof prepareSchema>,
): Promise<{ ok: true; rows: PreparedRow[] } | { ok: false; message: string }> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: READ_ONLY };
  const parsed = prepareSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: "Não conseguimos ler os lançamentos deste arquivo." };
  const { accountId, source } = parsed.data;
  const rows = withFingerprints(parsed.data.rows, source);

  const dates = rows.map((row) => row.date).sort();
  const firstMonth = addMonths(yearMonthOf(dates[0]!), -1);
  const lastMonth = addMonths(yearMonthOf(dates.at(-1)!), 1);
  const from = monthBounds(firstMonth).first;
  const to = monthBounds(lastMonth).last;

  const prepared = await withHousehold(ctx, async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (!account) return null;

    const inRange = await tx
      .select()
      .from(transactions)
      .where(and(gte(transactions.occurredOn, from), lte(transactions.occurredOn, to)));
    const planRows = await tx.select().from(cashflowPlans);
    const { scheduled } = await loadCommitments(tx, { from: firstMonth, to: lastMonth });

    const forecasts: KnownEntry[] = [];
    for (let month = firstMonth; month <= lastMonth; month = addMonths(month, 1)) {
      const entries = buildMonthEntries(
        month,
        planRows,
        inRange.filter((t) => yearMonthOf(t.occurredOn) === month),
        scheduled,
      );
      for (const entry of entries) {
        if (entry.status === "previsto" && entry.accountId === accountId) forecasts.push(entry);
      }
    }
    const realized: KnownEntry[] = inRange
      .filter((t) => t.accountId === accountId && t.status === "realizado")
      .map((t) => ({
        key: `t:${t.id}`,
        description: t.description,
        amount: t.amount,
        date: t.occurredOn,
        kind: t.kind,
        fingerprint: t.importFingerprint,
      }));

    const categoryRows = await tx
      .select({
        id: categories.id,
        name: categories.name,
        kind: categories.kind,
        archived: categories.archived,
      })
      .from(categories);
    const usable = categoryRows.filter((c) => !c.archived && c.name !== CARD_CATEGORY);
    const recent = await tx
      .select({
        kind: transactions.kind,
        description: transactions.description,
        categoryId: transactions.categoryId,
      })
      .from(transactions)
      .orderBy(desc(transactions.occurredOn))
      .limit(1000);
    const history = new Map<string, string>();
    for (const row of recent) {
      const key = `${row.kind}:${normalizeDescription(row.description)}`;
      if (!history.has(key)) history.set(key, row.categoryId);
    }

    return reconcileRows(rows, { realized, forecasts }).map((row) => ({
      ...row,
      categoryId: suggestCategory(row, usable, history),
    }));
  });
  if (!prepared) return { ok: false, message: "Escolha uma conta válida." };
  return { ok: true, rows: prepared };
}

/** Grava as linhas escolhidas. Reenviar o mesmo arquivo não duplica. */
export async function commitImport(
  input: z.input<typeof commitSchema>,
): Promise<{ ok: true; imported: number; settled: number } | { ok: false; message: string }> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: READ_ONLY };
  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Revise os lançamentos e tente de novo." };
  const { accountId, source, rows } = parsed.data;
  const dates = rows.map((row) => row.date).sort();

  const result = await withHousehold(ctx, async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (!account) return "Escolha uma conta válida.";
    const categoryRows = await tx
      .select({ id: categories.id, kind: categories.kind })
      .from(categories);
    const kinds = new Map(categoryRows.map((c) => [c.id, c.kind]));
    if (rows.some((row) => kinds.get(row.categoryId) !== row.kind))
      return "Escolha uma categoria válida em cada lançamento.";

    const [batch] = await tx
      .insert(importBatches)
      .values({
        householdId: ctx.householdId,
        accountId,
        source,
        rowCount: 0,
        periodStart: dates[0]!,
        periodEnd: dates.at(-1)!,
        createdBy: ctx.userId,
      })
      .returning({ id: importBatches.id });
    const batchId = batch!.id;

    let settled = 0;
    const plain: typeof rows = [];
    for (const row of rows) {
      const mark = { importFingerprint: row.fingerprint, importBatchId: batchId };
      const done =
        row.matchKey !== null &&
        (await confirmCommitment(tx, ctx, row.matchKey, row.matchMonth ?? "", mark));
      if (done) settled += 1;
      else plain.push(row);
    }
    const inserted =
      plain.length === 0
        ? []
        : await tx
            .insert(transactions)
            .values(
              plain.map((row) => ({
                householdId: ctx.householdId,
                accountId,
                categoryId: row.categoryId,
                kind: row.kind,
                description: row.description,
                amount: row.amount,
                occurredOn: row.date,
                status: "realizado" as const,
                importFingerprint: row.fingerprint,
                importBatchId: batchId,
                createdBy: ctx.userId,
              })),
            )
            .onConflictDoNothing()
            .returning({ id: transactions.id });

    const total = settled + inserted.length;
    if (total === 0) {
      await tx.delete(importBatches).where(eq(importBatches.id, batchId));
    } else {
      await tx.update(importBatches).set({ rowCount: total }).where(eq(importBatches.id, batchId));
      await audit(tx, ctx, "create", "import_batches", batchId);
    }
    return { imported: inserted.length, settled };
  });
  if (typeof result === "string") return { ok: false, message: result };
  revalidatePath("/app", "layout");
  return { ok: true, ...result };
}

/**
 * Desfaz um lote: apaga o que ele criou. Lançamento que já existia e só foi baixado volta a
 * ser previsto. Parcelas e faturas baixadas reabrem junto com o lançamento.
 */
export async function undoImport(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const [batch] = await tx.select().from(importBatches).where(eq(importBatches.id, id));
    if (!batch) return;
    const rows = await tx
      .select({ id: transactions.id, createdAt: transactions.createdAt })
      .from(transactions)
      .where(eq(transactions.importBatchId, id));
    const existed = rows.filter((row) => row.createdAt < batch.createdAt).map((row) => row.id);
    const created = rows.filter((row) => row.createdAt >= batch.createdAt).map((row) => row.id);
    if (existed.length > 0) {
      await tx
        .update(transactions)
        .set({
          status: "previsto",
          importFingerprint: null,
          importBatchId: null,
          updatedAt: new Date(),
        })
        .where(inArray(transactions.id, existed));
    }
    if (created.length > 0) await tx.delete(transactions).where(inArray(transactions.id, created));
    await tx.delete(importBatches).where(eq(importBatches.id, id));
    await audit(tx, ctx, "delete", "import_batches", id);
  });
  revalidatePath("/app", "layout");
}
