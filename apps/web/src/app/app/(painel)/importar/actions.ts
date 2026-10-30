"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  accounts,
  and,
  canWrite,
  cashflowPlans,
  categories,
  categoryMemory,
  desc,
  eq,
  gte,
  householdReports,
  IMPORT_SOURCES,
  importBatches,
  inArray,
  lte,
  recordCategorizationStats,
  sql,
  transactions,
  withHousehold,
} from "@organizeup/db";
import {
  addMonths,
  buildMonthEntries,
  CARD_CATEGORY,
  categorizeRow,
  importReport,
  memoryKey,
  merchantKey,
  monthBounds,
  normalizeDescription,
  reconcileRows,
  todayIn,
  withFingerprints,
  yearMonthOf,
  type CategoryProposal,
  type KnownEntry,
  type ReconciledRow,
} from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { loadCommitments } from "@/lib/commitments";
import { confirmCommitment } from "@/lib/confirm-entry";
import { requireTenant } from "@/lib/session";

const READ_ONLY = "Seu papel nesta família não permite alterações.";
export type PreparedRow = ReconciledRow & CategoryProposal;

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
        categoryId: z.string().min(1).nullable(),
        newCategory: z
          .object({ name: z.string().trim().min(1).max(60), essential: z.boolean() })
          .nullable(),
        source: z.enum(["memoria", "palavra", "nova", "revisar"]),
        corrected: z.boolean(),
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
      const key = memoryKey(row.kind, merchantKey(row.description));
      if (!history.has(key)) history.set(key, row.categoryId);
    }
    const remembered = await tx.select().from(categoryMemory);
    const learned = new Map(
      remembered.map((row) => [memoryKey(row.kind, row.merchant), row.categoryId]),
    );

    return reconcileRows(rows, { realized, forecasts }).map((row) => {
      const proposal = categorizeRow(row, usable, { history, learned });
      // Dar baixa não usa a categoria da linha: não há por que criar uma.
      const fallback = usable.find((category) => category.kind === row.kind)?.id ?? null;
      return row.state === "previsto" && proposal.newCategory
        ? { ...row, ...proposal, categoryId: fallback, newCategory: null }
        : { ...row, ...proposal };
    });
  });
  if (!prepared) return { ok: false, message: "Escolha uma conta válida." };
  return { ok: true, rows: prepared };
}

/** Grava as linhas escolhidas. Reenviar o mesmo arquivo não duplica. */
export async function commitImport(
  input: z.input<typeof commitSchema>,
): Promise<
  { ok: true; imported: number; settled: number; summary: string } | { ok: false; message: string }
> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: READ_ONLY };
  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Revise os lançamentos e tente de novo." };
  const { accountId, source } = parsed.data;
  const dates = parsed.data.rows.map((row) => row.date).sort();

  const result = await withHousehold(ctx, async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (!account) return "Escolha uma conta válida.";
    const categoryRows = await tx
      .select({
        id: categories.id,
        name: categories.name,
        kind: categories.kind,
        archived: categories.archived,
      })
      .from(categories);

    // Categoria nova entra agora, quando a família confirma. Nome igual reaproveita a existente.
    const created: string[] = [];
    for (const row of parsed.data.rows) {
      if (row.categoryId || !row.newCategory) continue;
      const name = row.newCategory.name;
      const known = categoryRows.find(
        (c) => c.kind === row.kind && normalizeDescription(c.name) === normalizeDescription(name),
      );
      if (known) {
        if (known.archived) {
          await tx.update(categories).set({ archived: false }).where(eq(categories.id, known.id));
          known.archived = false;
        }
        continue;
      }
      const [category] = await tx
        .insert(categories)
        .values({
          householdId: ctx.householdId,
          name,
          kind: row.kind,
          essential: row.newCategory.essential,
        })
        .returning({ id: categories.id });
      await audit(tx, ctx, "create", "categories", category!.id);
      categoryRows.push({ id: category!.id, name, kind: row.kind, archived: false });
      created.push(name);
    }
    const idOf = (kind: string, name: string) =>
      categoryRows.find(
        (c) => c.kind === kind && normalizeDescription(c.name) === normalizeDescription(name),
      )?.id;
    const rows = parsed.data.rows.map((row) => ({
      ...row,
      categoryId: row.categoryId ?? idOf(row.kind, row.newCategory?.name ?? "") ?? "",
    }));
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
      return { imported: 0, settled, summary: "", counts: null };
    }
    await tx.update(importBatches).set({ rowCount: total }).where(eq(importBatches.id, batchId));
    await audit(tx, ctx, "create", "import_batches", batchId);

    // Memória: a próxima importação já começa sabendo o que a família confirmou agora.
    const lessons = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const merchant = merchantKey(row.description);
      if (merchant) lessons.set(memoryKey(row.kind, merchant), row);
    }
    if (lessons.size > 0) {
      await tx
        .insert(categoryMemory)
        .values(
          [...lessons.values()].map((row) => ({
            householdId: ctx.householdId,
            kind: row.kind,
            merchant: merchantKey(row.description).slice(0, 120),
            categoryId: row.categoryId,
            source: row.corrected ? ("familia" as const) : ("agente" as const),
          })),
        )
        .onConflictDoUpdate({
          target: [categoryMemory.householdId, categoryMemory.kind, categoryMemory.merchant],
          set: {
            categoryId: sql`excluded.category_id`,
            source: sql`excluded.source`,
            hits: sql`${categoryMemory.hits} + 1`,
            updatedAt: new Date(),
          },
        });
    }

    const nameOf = new Map(categoryRows.map((c) => [c.id, c.name]));
    const report = importReport(
      rows.map((row) => ({
        kind: row.kind,
        amount: row.amount,
        category: nameOf.get(row.categoryId) ?? "",
        source: row.source,
        corrected: row.corrected,
      })),
      created,
      { start: dates[0]!, end: dates.at(-1)! },
    );
    await tx.insert(householdReports).values({
      householdId: ctx.householdId,
      agent: "categorizacao",
      kind: "importacao",
      period: batchId,
      title: report.title,
      summary: report.summary,
      data: report.data,
    });
    const { bySource, corrected } = report.data;
    return {
      imported: inserted.length,
      settled,
      summary: report.summary,
      counts: {
        rowCount: rows.length,
        fromMemory: bySource.memoria,
        fromWords: bySource.palavra + bySource.nova,
        unmatched: bySource.revisar,
        corrected,
        categoriesCreated: created.length,
      },
    };
  });
  if (typeof result === "string") return { ok: false, message: result };
  // As contagens são para a equipe de agentes: falhar aqui não pode estragar a importação.
  if (result.counts) {
    await recordCategorizationStats(todayIn(), result.counts).catch(() => undefined);
  }
  revalidatePath("/app", "layout");
  return { ok: true, imported: result.imported, settled: result.settled, summary: result.summary };
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
    await tx
      .update(householdReports)
      .set({ summary: sql`${householdReports.summary} || ' Importação desfeita depois.'` })
      .where(eq(householdReports.period, id));
    await audit(tx, ctx, "delete", "import_batches", id);
  });
  revalidatePath("/app", "layout");
}
