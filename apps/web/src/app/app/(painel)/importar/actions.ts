"use server";
import { getLocale, getTranslations } from "next-intl/server";
import { familyAccountType } from "@/i18n/account-server";
import { agentText } from "@/i18n/agent-text";
import type { Locale } from "@/i18n/locales";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  accountCurrency,
  canWrite,
  countEntries,
  currencyFrozen,
  lockEntryQuota,
  markEntries,
  readFamilyAccess,
  usageMonthOf,
  categories,
  categoryMemory,
  desc,
  ensureCategory,
  eq,
  fxSeries,
  householdCurrency,
  householdReports,
  IMPORT_SOURCES,
  importBatches,
  inArray,
  recordCategorizationStats,
  sql,
  transactions,
  withHousehold,
} from "@organizeup/db";
import {
  addMonths,
  quotaLeft,
  CARD_CATEGORY,
  categorizeRow,
  crossQuoteOn,
  entryFromTyped,
  fitsAmount,
  FX_CURRENCIES,
  importReport,
  isForeign,
  memoryKey,
  merchantKey,
  normalizeDescription,
  reconcileRows,
  todayIn,
  withFingerprints,
  yearMonthOf,
  type CategoryProposal,
  type Currency,
  type EntryMoney,
  type FxCurrency,
  type FxQuote,
  type ReconciledRow,
} from "@organizeup/domain";
import type { TenantTx } from "@organizeup/db";
import { formatDate } from "@/i18n/format";
import { audit } from "@/lib/audit";
import { loadKnownForImport } from "@/lib/import-known";
import {
  confirmCommitment,
  goalEntryLink,
  removeStatementCarry,
  reverseGoalSaved,
} from "@/lib/confirm-entry";
import { reportActionFailure } from "@/lib/diagnostics";
import { requireTenant } from "@/lib/session";

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
        /** A baixa é de renda estimada ou de fatura: vale o valor, a conta e o dia do extrato. */
        approx: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(MAX_ROWS),
});

const readOnly = async () => (await getTranslations("settings"))("noPermission");

/** Mensagens de quem converte as linhas, já no idioma da pessoa. */
async function converterTexts() {
  const [t, locale] = await Promise.all([getTranslations("importar.errors"), getLocale()]);
  return {
    noQuote: (currency: Currency, date: string) =>
      t("noQuote", { currency, date: formatDate(date, locale) }),
    overLimit: t("overLimit"),
  };
}

/**
 * Converte as linhas do arquivo, que estão na moeda da conta, pela cotação da data de cada uma. Devolve
 * a mensagem quando alguma não dá: sem cotação nessa data, ou valor que não cabe na moeda principal.
 */
async function rowConverter(
  tx: TenantTx,
  currency: Currency,
  rows: Array<{ date: string; amount: string }>,
  texts: Awaited<ReturnType<typeof converterTexts>>,
): Promise<((row: { date: string; amount: string }) => EntryMoney) | string> {
  const dates = rows.map((row) => row.date).sort();
  const main = await householdCurrency(tx);
  const series: Partial<Record<FxCurrency, FxQuote[]>> = {};
  if (isForeign(currency, main)) {
    for (const code of FX_CURRENCIES) {
      if (code === currency || code === main)
        series[code] = await fxSeries(tx, code, dates[0]!, dates.at(-1)!);
    }
  }
  const convert = (row: { date: string; amount: string }) =>
    entryFromTyped(row.amount, currency, crossQuoteOn(series, currency, main, row.date), main);
  for (const row of rows) {
    const entry = convert(row);
    if (!entry) return texts.noQuote(currency, row.date);
    if (!fitsAmount(entry.amount)) return texts.overLimit;
  }
  return (row) => convert(row)!;
}

/** Quantas linhas ainda cabem no mês. Null: sem limite. */
export type ImportRoom = number | null;

/** O arquivo passou do que cabia entre a conferência e a gravação: desfaz a transação inteira. */
class ImportOverLimit extends Error {
  constructor(readonly room: number) {
    super("limite_de_lancamentos");
  }
}

/** Compara o extrato com o que já existe. Não grava nada. */
export async function prepareImport(
  input: z.input<typeof prepareSchema>,
): Promise<{ ok: true; rows: PreparedRow[]; room: ImportRoom } | { ok: false; message: string }> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: await readOnly() };
  const t = await getTranslations("importar.errors");
  const texts = await converterTexts();
  const parsed = prepareSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: t("unreadable") };
  const { accountId, source } = parsed.data;
  const rows = withFingerprints(parsed.data.rows, source);

  const dates = rows.map((row) => row.date).sort();
  const firstMonth = addMonths(yearMonthOf(dates[0]!), -1);
  const lastMonth = addMonths(yearMonthOf(dates.at(-1)!), 1);

  const { entryLimit } = await readFamilyAccess(ctx);
  let room: ImportRoom = null;
  const prepared = await withHousehold(ctx, async (tx) => {
    const currency = await accountCurrency(tx, accountId);
    if (!currency) return null;
    if (await currencyFrozen(tx, currency)) return t("currencyOff", { currency });
    if (entryLimit !== null) {
      const month = await usageMonthOf(tx, ctx.householdId);
      room = quotaLeft(await countEntries(tx, month), entryLimit);
    }
    const converted = await rowConverter(tx, currency, rows, texts);
    if (typeof converted === "string") return converted;

    const main = await householdCurrency(tx);
    const known = await loadKnownForImport(
      tx,
      accountId,
      { first: firstMonth, last: lastMonth },
      !isForeign(currency, main),
    );

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

    return reconcileRows(rows, known, known.loose).map((row) => {
      const proposal = categorizeRow(row, usable, { history, learned });
      // Dar baixa não usa a categoria da linha: não há por que criar uma.
      const fallback = usable.find((category) => category.kind === row.kind)?.id ?? null;
      return row.state === "previsto" && proposal.newCategory
        ? { ...row, ...proposal, categoryId: fallback, newCategory: null }
        : { ...row, ...proposal };
    });
  }).catch((error: unknown) => {
    // Só nome e código: a mensagem do banco pode trazer dados da família.
    const { name, code } = error as { name?: string; code?: string };
    console.error(JSON.stringify({ level: "error", msg: "prepare_import_failed", name, code }));
    reportActionFailure("prepare_import_failed", error);
    return "falhou" as const;
  });
  if (prepared === "falhou") return { ok: false, message: t("serverFailed") };
  if (!prepared) return { ok: false, message: t("invalidAccount") };
  if (typeof prepared === "string") return { ok: false, message: prepared };
  return { ok: true, rows: prepared, room };
}

/** Grava as linhas escolhidas. Reenviar o mesmo arquivo não duplica. */
export async function commitImport(
  input: z.input<typeof commitSchema>,
): Promise<
  { ok: true; imported: number; settled: number; summary: string } | { ok: false; message: string }
> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: await readOnly() };
  const t = await getTranslations("importar.errors");
  const texts = await converterTexts();
  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: t("reviewRows") };
  const { accountId, source } = parsed.data;
  const dates = parsed.data.rows.map((row) => row.date).sort();
  const { entryLimit, mode } = await readFamilyAccess(ctx);

  const result = await withHousehold(ctx, async (tx) => {
    const currency = await accountCurrency(tx, accountId);
    if (!currency) return t("invalidAccount");
    if (await currencyFrozen(tx, currency)) return t("currencyOff", { currency });
    // Chave desligada não marca nada: a coluna pode ainda nem existir.
    const usageMonth = mode === "livre" ? null : await usageMonthOf(tx, ctx.householdId);
    // Segura as outras gravações da família até o fim: duas importações no limite não passam juntas.
    if (entryLimit !== null) await lockEntryQuota(tx, ctx.householdId);
    const converted = await rowConverter(tx, currency, parsed.data.rows, texts);
    if (typeof converted === "string") return converted;
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
      const result = await ensureCategory(
        tx,
        ctx.householdId,
        row.kind,
        name,
        row.newCategory.essential,
      );
      if (result.created) {
        await audit(tx, ctx, "create", "categories", result.id);
        categoryRows.push({ id: result.id, name, kind: row.kind, archived: false });
        created.push(name);
      } else {
        const known = categoryRows.find((c) => c.id === result.id);
        if (known) known.archived = false;
      }
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
    if (rows.some((row) => kinds.get(row.categoryId) !== row.kind)) return t("invalidCategory");

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
        (
          await (row.approx
            ? confirmCommitment(tx, ctx, row.matchKey, "", mark, row.date, {
                amount: row.amount,
                accountId,
              })
            : confirmCommitment(tx, ctx, row.matchKey, row.matchMonth ?? "", mark))
        ).done;
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
                ...converted(row),
                occurredOn: row.date,
                status: "realizado" as const,
                importFingerprint: row.fingerprint,
                importBatchId: batchId,
                // Quem escolheu a categoria: a família (corrigiu), ninguém (caiu em "revisar")
                // ou o agente da importação. O agente diário só mexe no que ficou para revisar.
                categorySource: row.corrected
                  ? ("familia" as const)
                  : row.source === "revisar"
                    ? ("revisar" as const)
                    : ("importacao" as const),
                createdBy: ctx.userId,
              })),
            )
            .onConflictDoNothing()
            .returning({ id: transactions.id });
    // Conta depois de gravar, porque linha repetida não entra. Passou: nada fica, nem pela metade.
    await markEntries(
      tx,
      usageMonth,
      inserted.map((row) => row.id),
    );
    if (entryLimit !== null && usageMonth) {
      const used = await countEntries(tx, usageMonth);
      if (used > entryLimit) {
        throw new ImportOverLimit(quotaLeft(used - inserted.length, entryLimit));
      }
    }

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
        amount: converted(row).amount,
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
      messageKey: report.message.key,
      messageParams: report.message.params ?? null,
      data: report.data,
    });
    const { bySource, corrected } = report.data;
    return {
      imported: inserted.length,
      settled,
      summary: agentText(
        {
          title: report.title,
          body: report.summary,
          messageKey: report.message.key,
          messageParams: report.message.params ?? null,
        },
        (await getLocale()) as Locale,
        await familyAccountType(),
      ).body,
      counts: {
        rowCount: rows.length,
        fromMemory: bySource.memoria,
        fromWords: bySource.palavra + bySource.nova,
        unmatched: bySource.revisar,
        corrected,
        categoriesCreated: created.length,
      },
    };
  }).catch((error: unknown) => {
    if (error instanceof ImportOverLimit) return t("quota", { count: error.room });
    throw error;
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
    // Parcela de meta baixada pelo extrato: a receita espelho sai junto e o guardado volta.
    const links = (await Promise.all(created.map((row) => goalEntryLink(tx, row)))).filter(
      (link) => link !== null,
    );
    const removing = new Set([...created, ...links.flatMap((link) => link.transactionIds)]);
    if (removing.size > 0) {
      // Fatura paga em parte pelo extrato: o restante que foi para a fatura seguinte sai junto.
      await removeStatementCarry(tx, [...removing]);
      await tx.delete(transactions).where(inArray(transactions.id, [...removing]));
    }
    for (const link of links) await reverseGoalSaved(tx, ctx, link);
    await tx.delete(importBatches).where(eq(importBatches.id, id));
    await tx
      .update(householdReports)
      .set({
        summary: sql`${householdReports.summary} || ' Importação desfeita depois.'`,
        messageParams: sql`jsonb_insert(${householdReports.messageParams}, '{parts,messages,-1}', '{"key":"frases.relImportacaoDesfeita"}'::jsonb, true)`,
      })
      .where(eq(householdReports.period, id));
    await audit(tx, ctx, "delete", "import_batches", id);
  });
  revalidatePath("/app", "layout");
}
