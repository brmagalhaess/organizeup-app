// Importador inteligente (ADR-0030): lote, arquivos e propostas no banco. Tudo roda no `tx` recebido, com RLS,
// e nada aqui chama o modelo. Quem grava de verdade é a aprovação, na web: aqui só nasce rascunho (regra 7).
import {
  accessWithin,
  accounts,
  and,
  asc,
  canWrite,
  cardPurchases,
  cashflowPlans,
  categories,
  categoryMemory,
  creditCards,
  debtInstallments,
  debts,
  desc,
  dividends,
  eq,
  goals,
  gte,
  householdNotifications,
  incomeSources,
  inArray,
  investments,
  investmentTrades,
  isNotNull,
  isNull,
  isSchemaLag,
  lockFamilyImport,
  loadStockEvents,
  lt,
  lte,
  marketDividends,
  ne,
  or,
  smartImportFileMeta,
  smartImportFiles,
  smartImportItems,
  smartImports,
  sql,
  transactions,
  householdTimezone,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  addMonths,
  buildMonthEntries,
  canUse,
  CARD_CATEGORY,
  categorizeRow,
  entryOrigin,
  memoryKey,
  merchantKey,
  monthBounds,
  findRecordedPayments,
  planSmartDuplicates,
  SMART_BATCH_MAX_BYTES,
  SMART_DESTINATION_MODULE,
  SMART_FAMILY_MAX_BYTES,
  SMART_MAX_FILES,
  SMART_MAX_OPEN_ITEMS,
  SMART_REVIEW_PAGE_SIZE,
  SMART_READ_MAX_ATTEMPTS,
  SMART_RETENTION_DAYS,
  SMART_STALE_MS,
  smartVerdictWorse,
  suggestByIssuer,
  todayIn,
  toDbAmount,
  yearMonthOf,
  type CategoryChoice,
  type CategoryOption,
  type KnownEntry,
  type SmartItemRef,
  type SmartKnown,
  type SmartDestination,
  type SmartPayload,
  type SmartReading,
  type SmartVerdict,
} from "@organizeup/domain";
import { loadCommitments, systemCategories } from "./commitments";
import { loadBlocks } from "./market-sync";
import { messageColumns, recordAudit } from "./shared";
import { smartImportReadyText } from "./texts";

/** Agente por pedido: não entra na rodada diária, e aparece no painel do serviço. */
export const IMPORTADOR_AGENT = "importador";

export type SmartImportRow = typeof smartImports.$inferSelect;
export type SmartFileMeta = Awaited<ReturnType<typeof listSmartFiles>>[number];
export type SmartItemRow = typeof smartImportItems.$inferSelect;

/** `preview`: lote do admin do serviço, com a liberação desligada. Só ele passa pelo worker nessa fase. */
export async function createSmartImport(
  tx: TenantTx,
  ctx: TenantContext,
  preview = false,
): Promise<string | null> {
  if (!canWrite(ctx)) return null;
  const [row] = await tx
    .insert(smartImports)
    .values({ householdId: ctx.householdId, createdBy: ctx.userId, preview })
    .returning({ id: smartImports.id });
  await recordAudit(tx, ctx, "create", "smart_imports", row!.id);
  return row!.id;
}

export async function smartImportIsPreview(tx: TenantTx, importId: string): Promise<boolean> {
  const [row] = await tx
    .select({ preview: smartImports.preview })
    .from(smartImports)
    .where(eq(smartImports.id, importId));
  return row?.preview ?? false;
}

/** Itens em aberto da família, em todos os lotes. O índice parcial da 0042 responde sem varrer tudo. */
export async function countOpenSmartItems(tx: TenantTx): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(smartImportItems)
    .where(ne(smartImportItems.status, "gravado"));
  return row?.total ?? 0;
}

export async function listSmartImports(tx: TenantTx, limit = 20) {
  return tx.select().from(smartImports).orderBy(desc(smartImports.createdAt)).limit(limit);
}

export async function listSmartFiles(tx: TenantTx, importId: string) {
  return tx
    .select(smartImportFileMeta)
    .from(smartImportFiles)
    .where(eq(smartImportFiles.importId, importId))
    .orderBy(asc(smartImportFiles.position));
}

export async function listSmartFilesOf(tx: TenantTx, ids: string[]) {
  if (ids.length === 0) return [];
  return tx
    .select({
      importId: smartImportFiles.importId,
      status: smartImportFiles.status,
      fileName: smartImportFiles.fileName,
    })
    .from(smartImportFiles)
    .where(inArray(smartImportFiles.importId, ids));
}

export async function listSmartItems(tx: TenantTx, importId: string) {
  return tx
    .select()
    .from(smartImportItems)
    .where(eq(smartImportItems.importId, importId))
    .orderBy(asc(smartImportItems.position));
}

/** Só para baixar e para ler: é a única consulta que carrega o arquivo. */
export async function loadSmartFileContent(tx: TenantTx, id: string) {
  const [row] = await tx
    .select({
      fileName: smartImportFiles.fileName,
      mediaType: smartImportFiles.mediaType,
      content: smartImportFiles.content,
    })
    .from(smartImportFiles)
    .where(eq(smartImportFiles.id, id));
  return row ?? null;
}

async function sha256Of(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type SaveSmartFileResult =
  | { ok: true; id: string; duplicate: boolean }
  | {
      ok: false;
      code:
        | "somente_leitura"
        | "lote"
        | "muitos"
        | "cota_lote"
        | "cota"
        | "em_outro_lote"
        | "teto_itens";
      /** Lote aberto que já tem este arquivo: a tela oferece abrir ou descartar. */
      otherImportId?: string;
    };

/** Guarda um arquivo já conferido por `checkSmartFile`. A trava segura a cota contra envios juntos. */
export async function saveSmartFile(
  tx: TenantTx,
  ctx: TenantContext,
  file: { importId: string; fileName: string; mediaType: string; bytes: Uint8Array },
): Promise<SaveSmartFileResult> {
  if (!canWrite(ctx)) return { ok: false, code: "somente_leitura" };
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`smart_import:${ctx.householdId}`}, 0))`,
  );
  const [lot] = await tx
    .select({ status: smartImports.status })
    .from(smartImports)
    .where(eq(smartImports.id, file.importId));
  if (lot?.status !== "enviando") return { ok: false, code: "lote" };
  const sha256 = await sha256Of(file.bytes);
  const present = await tx
    .select({
      id: smartImportFiles.id,
      sha256: smartImportFiles.sha256,
      position: smartImportFiles.position,
      sizeBytes: smartImportFiles.sizeBytes,
    })
    .from(smartImportFiles)
    .where(eq(smartImportFiles.importId, file.importId));
  const same = present.find((row) => row.sha256 === sha256);
  if (same) return { ok: true, id: same.id, duplicate: true };
  if (present.length >= SMART_MAX_FILES) return { ok: false, code: "muitos" };
  // Em lote aberto, os dois seriam aprovados como novos. Depois de aprovado, volta como já lançado.
  const [open] = await tx
    .select({ importId: smartImportFiles.importId })
    .from(smartImportFiles)
    .innerJoin(smartImports, eq(smartImports.id, smartImportFiles.importId))
    .where(
      and(
        eq(smartImportFiles.sha256, sha256),
        ne(smartImportFiles.importId, file.importId),
        ne(smartImports.status, "concluido"),
      ),
    )
    .limit(1);
  if (open) return { ok: false, code: "em_outro_lote", otherImportId: open.importId };
  if ((await countOpenSmartItems(tx)) >= SMART_MAX_OPEN_ITEMS) {
    return { ok: false, code: "teto_itens" };
  }
  const inLot = present.reduce((acc, row) => acc + row.sizeBytes, 0);
  if (inLot + file.bytes.length > SMART_BATCH_MAX_BYTES) return { ok: false, code: "cota_lote" };
  const [usage] = await tx
    .select({ total: sql<string>`coalesce(sum(${smartImportFiles.sizeBytes}), 0)::text` })
    .from(smartImportFiles);
  if (Number(usage?.total ?? 0) + file.bytes.length > SMART_FAMILY_MAX_BYTES) {
    return { ok: false, code: "cota" };
  }
  const taken = new Set(present.map((row) => row.position));
  const position = Array.from({ length: SMART_MAX_FILES }, (_, index) => index).find(
    (index) => !taken.has(index),
  )!;
  const [row] = await tx
    .insert(smartImportFiles)
    .values({
      householdId: ctx.householdId,
      importId: file.importId,
      position,
      fileName: file.fileName,
      mediaType: file.mediaType,
      sizeBytes: file.bytes.length,
      content: file.bytes,
      sha256,
    })
    .returning({ id: smartImportFiles.id });
  await recordAudit(tx, ctx, "create", "smart_import_files", row!.id);
  return { ok: true, id: row!.id, duplicate: false };
}

/** Fecha o envio. Devolve falso se o lote não existe, não tem arquivo ou já começou. */
export async function queueSmartImport(
  tx: TenantTx,
  ctx: TenantContext,
  importId: string,
  useAi: boolean,
): Promise<boolean> {
  if (!canWrite(ctx)) return false;
  const [file] = await tx
    .select({ id: smartImportFiles.id })
    .from(smartImportFiles)
    .where(eq(smartImportFiles.importId, importId))
    .limit(1);
  if (!file) return false;
  const rows = await tx
    .update(smartImports)
    .set({ status: "na_fila", useAi, queuedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(smartImports.id, importId), eq(smartImports.status, "enviando")))
    .returning({ id: smartImports.id });
  return rows.length > 0;
}

/** Marca que o aviso à fila foi repetido, para a tela não pedir de novo a cada olhada. */
export async function touchSmartImport(tx: TenantTx, importId: string): Promise<void> {
  await tx.update(smartImports).set({ queuedAt: new Date() }).where(eq(smartImports.id, importId));
}

/**
 * Volta o arquivo que falhou para a fila, com as tentativas zeradas. O que já foi gravado fica; só as propostas
 * pendentes são refeitas. Pedir para ler de novo é pedir a leitura completa, então o lote passa a aceitar IA:
 * quem barra é o portão.
 */
export async function requeueSmartFile(
  tx: TenantTx,
  ctx: TenantContext,
  fileId: string,
): Promise<string | null> {
  if (!canWrite(ctx)) return null;
  const [file] = await tx
    .update(smartImportFiles)
    .set({ status: "na_fila", failure: null, readAttempts: 0, updatedAt: new Date() })
    .where(and(eq(smartImportFiles.id, fileId), eq(smartImportFiles.status, "falhou")))
    .returning({ importId: smartImportFiles.importId });
  if (!file) return null;
  await tx
    .delete(smartImportItems)
    .where(and(eq(smartImportItems.fileId, fileId), ne(smartImportItems.status, "gravado")));
  await tx
    .update(smartImports)
    .set({ status: "na_fila", useAi: true, queuedAt: new Date(), updatedAt: new Date() })
    .where(eq(smartImports.id, file.importId));
  return file.importId;
}

/** O worker pega o lote. Quem já acabou fica como está: repetir o aviso não refaz nada. */
export async function startSmartImport(tx: TenantTx, importId: string) {
  const [lot] = await tx
    .update(smartImports)
    .set({ status: "lendo", updatedAt: new Date() })
    .where(and(eq(smartImports.id, importId), inArray(smartImports.status, ["na_fila", "lendo"])))
    .returning({ useAi: smartImports.useAi, createdBy: smartImports.createdBy });
  return lot ?? null;
}

/**
 * Próximo arquivo, um por vez. Leitura presa, de worker que caiu, volta a valer depois do prazo, até o limite de
 * tentativas: daí em diante o arquivo é falho, para quem derruba a leitura não entrar em laço.
 */
export async function claimSmartFile(tx: TenantTx, importId: string, now = new Date()) {
  const staleBefore = new Date(now.getTime() - SMART_STALE_MS);
  const stale = and(
    eq(smartImportFiles.status, "lendo"),
    lt(smartImportFiles.updatedAt, staleBefore),
  );
  await tx
    .update(smartImportFiles)
    .set({ status: "falhou", failure: "queda", updatedAt: now })
    .where(
      and(
        eq(smartImportFiles.importId, importId),
        stale,
        gte(smartImportFiles.readAttempts, SMART_READ_MAX_ATTEMPTS),
      ),
    );
  const [next] = await tx
    .select({ id: smartImportFiles.id })
    .from(smartImportFiles)
    .where(
      and(
        eq(smartImportFiles.importId, importId),
        or(eq(smartImportFiles.status, "na_fila"), stale),
      ),
    )
    .orderBy(asc(smartImportFiles.position))
    .limit(1)
    .for("update", { skipLocked: true });
  if (!next) return null;
  const [file] = await tx
    .update(smartImportFiles)
    .set({
      status: "lendo",
      readAttempts: sql`${smartImportFiles.readAttempts} + 1`,
      updatedAt: now,
    })
    .where(eq(smartImportFiles.id, next.id))
    .returning({
      id: smartImportFiles.id,
      mediaType: smartImportFiles.mediaType,
      content: smartImportFiles.content,
      sha256: smartImportFiles.sha256,
    });
  return file ?? null;
}

/** Mesmo arquivo já lido com IA em outro lote: não paga de novo. */
export async function priorSmartReading(
  tx: TenantTx,
  sha256: string,
  fileId: string,
): Promise<(SmartReading & { truncated: boolean }) | null> {
  const [file] = await tx
    .select(smartImportFileMeta)
    .from(smartImportFiles)
    .where(
      and(
        eq(smartImportFiles.sha256, sha256),
        ne(smartImportFiles.id, fileId),
        eq(smartImportFiles.status, "lido"),
        eq(smartImportFiles.method, "modelo"),
      ),
    )
    .orderBy(desc(smartImportFiles.createdAt))
    .limit(1);
  if (!file) return null;
  const items = await tx
    .select()
    .from(smartImportItems)
    .where(eq(smartImportItems.fileId, file.id))
    .orderBy(asc(smartImportItems.position));
  return {
    docType: (file.docType ?? "outro") as SmartReading["docType"],
    issuer: file.issuer,
    confidence: file.confidence ?? "baixa",
    fields: file.fields,
    notes: file.notes,
    truncated: file.truncated,
    proposals: items.map((item) => ({
      payload: item.payload,
      confidence: item.confidence,
      excerpt: item.excerpt,
    })),
  };
}

export interface SmartReadingResult {
  fileId: string;
  importId: string;
  householdId: string;
  reading: SmartReading;
  method: "regras" | "modelo";
  truncated: boolean;
}

/**
 * Rascunho do arquivo. Refazer troca o que estava pendente; o que já foi gravado continua. Falso: passaria do
 * teto de itens em aberto da família, e nada entra.
 */
export async function saveSmartReading(
  tx: TenantTx,
  input: SmartReadingResult,
  maxOpen = SMART_MAX_OPEN_ITEMS,
): Promise<boolean> {
  const { fileId, importId, householdId, reading, method, truncated } = input;
  await tx
    .delete(smartImportItems)
    .where(and(eq(smartImportItems.fileId, fileId), ne(smartImportItems.status, "gravado")));
  const [last] = await tx
    .select({ top: sql<number>`coalesce(max(${smartImportItems.position}), -1)::int` })
    .from(smartImportItems)
    .where(eq(smartImportItems.fileId, fileId));
  const start = (last?.top ?? -1) + 1;
  if ((await countOpenSmartItems(tx)) + reading.proposals.length > maxOpen) return false;
  const hints = await categoryHints(tx);
  const rows = reading.proposals.map((proposal, index) => ({
    householdId,
    importId,
    fileId,
    position: start + index,
    destination: proposal.payload.destination,
    confidence: proposal.confidence,
    excerpt: proposal.excerpt,
    payload: withCategory(proposal.payload, hints),
  }));
  // Lotes grandes: o limite de parâmetros do Postgres fica longe assim.
  for (let at = 0; at < rows.length; at += 200) {
    await tx.insert(smartImportItems).values(rows.slice(at, at + 200));
  }
  await tx
    .update(smartImportFiles)
    .set({
      status: "lido",
      docType: reading.docType,
      issuer: reading.issuer,
      confidence: reading.confidence,
      method,
      failure: null,
      truncated,
      fields: reading.fields,
      notes: reading.notes,
      reviewed: false,
      updatedAt: new Date(),
    })
    .where(eq(smartImportFiles.id, fileId));
  return true;
}

export async function failSmartFile(tx: TenantTx, fileId: string, failure: string): Promise<void> {
  await tx
    .update(smartImportFiles)
    .set({ status: "falhou", failure, updatedAt: new Date() })
    .where(eq(smartImportFiles.id, fileId));
}

interface CategoryHints {
  usable: CategoryOption[];
  memory: Parameters<typeof categorizeRow>[2];
}

async function categoryHints(tx: TenantTx): Promise<CategoryHints> {
  const rows = await tx
    .select({
      id: categories.id,
      name: categories.name,
      kind: categories.kind,
      archived: categories.archived,
    })
    .from(categories);
  const usable = rows.filter((row) => !row.archived && row.name !== CARD_CATEGORY);
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
  return { usable, memory: { history, learned } };
}

function withCategory(payload: SmartPayload, hints: CategoryHints): SmartPayload {
  const choose = (description: string, kind: "receita" | "despesa"): CategoryChoice => {
    const proposal = categorizeRow({ description, kind }, hints.usable, hints.memory);
    return {
      categoryId: proposal.categoryId,
      newCategory: proposal.newCategory,
      categorySource: proposal.source,
    };
  };
  switch (payload.destination) {
    case "lancamento":
    case "previsao":
      return payload.description
        ? { ...payload, ...choose(payload.description, payload.kind) }
        : payload;
    case "compra_cartao":
      return payload.description
        ? { ...payload, ...choose(payload.description, "despesa") }
        : payload;
    case "renda":
      return payload.name ? { ...payload, ...choose(payload.name, "receita") } : payload;
    default:
      return payload;
  }
}

async function knownForecasts(tx: TenantTx, from: string, to: string, rows: KnownSource) {
  const planRows = await tx.select().from(cashflowPlans);
  const { scheduled } = await loadCommitments(tx, { from, to });
  const forecasts: KnownEntry[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) {
    const entries = buildMonthEntries(
      month,
      planRows,
      rows.filter((row) => yearMonthOf(row.occurredOn) === month),
      scheduled,
    );
    for (const entry of entries) {
      if (entry.status === "previsto") {
        forecasts.push({ ...entry, amount: entry.originalAmount ?? entry.amount });
      }
    }
  }
  return forecasts;
}

type KnownSource = Array<typeof transactions.$inferSelect>;

/**
 * Tudo o que a comparação precisa, só do período dos itens. Lê; nada grava. `exclude`: o que este mesmo lote já
 * gravou, que na aprovação não pode contar como duplicado dele mesmo.
 */
export async function loadSmartKnown(
  tx: TenantTx,
  ctx: Pick<TenantContext, "householdId">,
  dates: string[],
  exclude: ReadonlySet<string> = new Set(),
  tickers: string[] = [],
): Promise<SmartKnown> {
  const sorted = dates.toSorted();
  const today = new Date().toISOString().slice(0, 10);
  const firstMonth = addMonths(yearMonthOf(sorted[0] ?? today), -1);
  const lastMonth = addMonths(yearMonthOf(sorted.at(-1) ?? today), 1);
  const from = monthBounds(firstMonth).first;
  const to = monthBounds(lastMonth).last;
  const inRange = await tx
    .select()
    .from(transactions)
    .where(and(gte(transactions.occurredOn, from), lte(transactions.occurredOn, to)));
  const { card: cardCategory } = await systemCategories(tx);
  const realized: KnownEntry[] = inRange
    .filter((row) => row.status === "realizado" && !exclude.has(row.id))
    .map((row) => ({
      key: `t:${row.id}`,
      description: row.description,
      amount: entryOrigin(row)?.amount ?? row.amount,
      date: row.occurredOn,
      kind: row.kind,
      fingerprint: row.importFingerprint,
      accountId: row.accountId,
      settled: row.categoryId === cardCategory,
    }));
  const purchases = await tx
    .select({
      id: cardPurchases.id,
      description: cardPurchases.description,
      amount: cardPurchases.amount,
      date: cardPurchases.purchasedOn,
      cardId: cardPurchases.cardId,
    })
    .from(cardPurchases)
    .where(and(gte(cardPurchases.purchasedOn, from), lte(cardPurchases.purchasedOn, to)));

  const stockEvents = await loadStockEvents(tx);
  const [holdings, trades] = await Promise.all([
    tx.select().from(investments),
    tx.select().from(investmentTrades),
  ]);
  const openDebts = await tx
    .select({ id: debts.id, name: debts.name })
    .from(debts)
    .where(eq(debts.archived, false));
  const open = await tx
    .select({
      debtId: debtInstallments.debtId,
      number: debtInstallments.number,
      amount: debtInstallments.amount,
    })
    .from(debtInstallments)
    .where(isNull(debtInstallments.transactionId));
  const incomes = await tx
    .select({ id: incomeSources.id, name: incomeSources.name, amount: incomeSources.amount })
    .from(incomeSources);
  const plans = await tx
    .select({
      id: cashflowPlans.id,
      description: cashflowPlans.description,
      amount: cashflowPlans.amount,
      kind: cashflowPlans.kind,
    })
    .from(cashflowPlans);
  const goalRows = await tx.select({ id: goals.id, name: goals.name }).from(goals);
  const dividendRows = await tx.select().from(dividends);
  const events = tickers.length
    ? await tx
        .select({
          id: marketDividends.id,
          ticker: marketDividends.ticker,
          kind: marketDividends.kind,
          comDate: marketDividends.comDate,
          payDate: marketDividends.payDate,
        })
        .from(marketDividends)
        .where(inArray(marketDividends.ticker, tickers))
    : [];
  const blocks = await loadBlocks(tx);
  const documents = await tx
    .select({ id: smartImportFiles.id, sha256: smartImportFiles.sha256 })
    .from(smartImportFiles)
    .where(isNotNull(smartImportFiles.attachedAt));
  const kept = <T extends { id: string }>(rows: T[]) => rows.filter((row) => !exclude.has(row.id));

  return {
    realized,
    forecasts: await knownForecasts(tx, firstMonth, lastMonth, inRange),
    purchases: kept(purchases),
    holdings: holdings.map((holding) => ({
      id: holding.id,
      name: holding.name,
      ticker: holding.ticker,
      assetClass: holding.assetClass,
      trades: trades.filter((trade) => trade.investmentId === holding.id),
      events: stockEvents.filter((event) => event.investmentId === holding.id),
    })),
    debts: kept(openDebts).map((debt) => {
      const rows = open.filter((row) => row.debtId === debt.id);
      const next = rows.toSorted((a, b) => a.number - b.number)[0];
      return {
        id: debt.id,
        name: debt.name,
        nextAmount: next?.amount ?? null,
        openInstallments: rows.length,
      };
    }),
    incomes: kept(incomes),
    plans: kept(plans),
    goals: kept(goalRows),
    dividendHoldings: holdings.map((holding) => ({
      id: holding.id,
      name: holding.name,
      ticker: holding.ticker,
      assetClass: holding.assetClass,
      dividends: dividendRows.filter((row) => row.investmentId === holding.id),
    })),
    dividendEvents: events,
    dividendBlocked: [...blocks.proventos].map(([id, set]) => [id, [...set]]),
    today: todayIn(await householdTimezone(tx, ctx.householdId)),
    documents: Object.fromEntries(documents.map((row) => [row.sha256, row.id])),
  };
}

export const smartDatesOf = (payload: SmartPayload): string[] => {
  if ("date" in payload && payload.date) return [payload.date];
  return [];
};

const VERDICT_CHUNK = 1_000;

export interface SmartReviewPlan {
  importId: string;
  files: Awaited<ReturnType<typeof listSmartFiles>>;
  items: SmartItemRow[];
  pending: SmartItemRow[];
  refs: SmartItemRef[];
  known: SmartKnown;
  sha: Record<string, string>;
  scope: Record<string, { accountId: string | null; cardId: string | null }>;
}

const tickersOf = (items: SmartItemRow[]) => [
  ...new Set(
    items.flatMap(({ payload }) =>
      payload.destination === "provento" && payload.ticker ? [payload.ticker] : [],
    ),
  ),
];

/**
 * Primeira parte da revisão: escolhe conta e cartão sugeridos e carrega o que a comparação precisa. Conta vem antes,
 * porque a comparação olha a conta do arquivo. A comparação em si roda fora, sem transação aberta.
 */
export async function prepareSmartReview(
  tx: TenantTx,
  ctx: Pick<TenantContext, "householdId">,
  importId: string,
): Promise<SmartReviewPlan> {
  const accountRows = await tx
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.archived, false));
  const cardRows = await tx
    .select({ id: creditCards.id, name: creditCards.name })
    .from(creditCards)
    .where(eq(creditCards.archived, false));
  const listed = await listSmartFiles(tx, importId);
  const files = listed.map((file) => {
    if (file.reviewed || file.status !== "lido") return file;
    return {
      ...file,
      accountId: file.accountId ?? suggestByIssuer(file.issuer, accountRows),
      cardId: file.cardId ?? suggestByIssuer(file.issuer, cardRows),
    };
  });
  for (const file of files) {
    if (file.reviewed || file.status !== "lido") continue;
    await tx
      .update(smartImportFiles)
      .set({ accountId: file.accountId, cardId: file.cardId })
      .where(eq(smartImportFiles.id, file.id));
  }
  const items = await listSmartItems(tx, importId);
  const pending = items.filter((item) => item.status !== "gravado");
  const byId = new Map(files.map((file) => [file.id, file]));
  const refs: SmartItemRef[] = pending
    .toSorted(
      (a, b) =>
        byId.get(a.fileId)!.position - byId.get(b.fileId)!.position || a.position - b.position,
    )
    .map(({ id, fileId, payload }) => ({ id, fileId, payload }));
  const known = await loadSmartKnown(
    tx,
    ctx,
    pending.flatMap((item) => smartDatesOf(item.payload)),
    new Set(),
    tickersOf(pending),
  );
  return {
    importId,
    files,
    items,
    pending,
    refs,
    known,
    sha: Object.fromEntries(files.map((file) => [file.id, file.sha256])),
    scope: Object.fromEntries(
      files.map((file) => [file.id, { accountId: file.accountId, cardId: file.cardId }]),
    ),
  };
}

/** Sem processo isolado à mão: a mesma comparação, aqui mesmo. */
export const planSmartReview = (plan: SmartReviewPlan) =>
  planSmartDuplicates(plan.refs, plan.known, {
    shaOf: (id) => plan.sha[id],
    scope: (id) => plan.scope[id] ?? { accountId: null, cardId: null },
  });

/** Pagamento de fatura já gravado vira uma proposta de baixa, nunca marcada. Reler não repete. */
async function proposeRecordedPayments(
  tx: TenantTx,
  householdId: string,
  plan: SmartReviewPlan,
): Promise<number> {
  const done = new Set(
    plan.items.flatMap(({ payload }) =>
      payload.destination === "lancamento" && payload.settlesTransactionId
        ? [payload.settlesTransactionId]
        : [],
    ),
  );
  const fresh = findRecordedPayments(plan.refs, plan.known).filter(
    (row) => !done.has(row.transactionId),
  );
  for (const row of fresh) {
    const [last] = await tx
      .select({ top: sql<number>`coalesce(max(${smartImportItems.position}), -1)::int` })
      .from(smartImportItems)
      .where(eq(smartImportItems.fileId, row.fileId));
    const payload: SmartPayload = {
      destination: "lancamento",
      date: row.date,
      description: row.description,
      amount: row.amount,
      kind: "despesa",
      fingerprint: null,
      source: "csv",
      accountId: row.accountId,
      matchKey: null,
      matchMonth: null,
      settlesFileId: row.fileId,
      settlesTransactionId: row.transactionId,
      categoryId: null,
      newCategory: null,
      categorySource: null,
    };
    await tx.insert(smartImportItems).values({
      householdId,
      importId: plan.importId,
      fileId: row.fileId,
      position: (last?.top ?? -1) + 1,
      destination: "lancamento",
      confidence: "media",
      excerpt: `${row.date} ${row.description} ${row.amount}`.slice(0, 300),
      duplicate: "possivel",
      duplicateReason: "pagamento_gravado",
      payload,
    });
  }
  return fresh.length;
}

/**
 * Segunda parte: grava o veredito e abre a revisão. Só nos arquivos ainda não revisados a seleção volta ao padrão,
 * e no padrão baixa confiança nunca vem marcada. Depois disso a seleção é da pessoa, menos o item que piorou. Uma
 * instrução por pedaço, porque um lote pode ter 50 mil itens.
 */
export async function applySmartReview(
  tx: TenantTx,
  householdId: string,
  plan: SmartReviewPlan,
  verdicts: ReadonlyMap<string, SmartVerdict>,
): Promise<{ items: number; failed: number; files: number }> {
  await lockFamilyImport(tx, householdId);
  const { importId, files, items, pending } = plan;
  const created = await proposeRecordedPayments(tx, householdId, plan);
  const reviewed = new Set(files.filter((file) => file.reviewed).map((file) => file.id));
  const access = await accessWithin(tx);
  const rows = pending.map((item) => {
    const verdict = verdicts.get(item.id);
    const owner = SMART_DESTINATION_MODULE[item.destination];
    const allowed = owner === null || canUse(access, owner);
    const recorded =
      item.payload.destination === "lancamento" ? item.payload.settlesTransactionId : null;
    const duplicate = recorded ? "possivel" : (verdict?.duplicate ?? "novo");
    return {
      id: item.id,
      duplicate,
      reason: recorded ? "pagamento_gravado" : (verdict?.reason ?? null),
      file: verdict?.otherFileId ?? null,
      selected: reviewed.has(item.fileId)
        ? item.selected && !smartVerdictWorse(item.duplicate, duplicate)
        : duplicate === "novo" && allowed && item.confidence !== "baixa",
      match_key: recorded ? null : (verdict?.matchKey ?? null),
      match_month: recorded ? null : (verdict?.matchMonth ?? null),
      settles: recorded
        ? item.payload.destination === "lancamento" && item.payload.settlesFileId
        : (verdict?.settlesFileId ?? null),
      plan_state: verdict?.plan?.state ?? null,
      plan_doubt: verdict?.plan?.doubt ?? null,
    };
  });
  for (let at = 0; at < rows.length; at += VERDICT_CHUNK) {
    const chunk = JSON.stringify(rows.slice(at, at + VERDICT_CHUNK));
    await tx.execute(sql`
      update smart_import_items as item
      set duplicate = verdict.duplicate,
          duplicate_reason = verdict.reason,
          duplicate_file_id = verdict.file,
          selected = verdict.selected,
          updated_at = now(),
          payload = case item.destination
            when 'lancamento' then item.payload || jsonb_build_object(
              'matchKey', verdict.match_key,
              'matchMonth', verdict.match_month,
              'settlesFileId', verdict.settles)
            when 'provento' then item.payload || jsonb_build_object(
              'planState', verdict.plan_state,
              'planDoubt', verdict.plan_doubt)
            else item.payload end
      from jsonb_to_recordset(${chunk}::jsonb) as verdict(
        id text, duplicate text, reason text, file text, selected boolean,
        match_key text, match_month text, settles text, plan_state text, plan_doubt text)
      where item.id = verdict.id`);
  }
  await tx
    .update(smartImportFiles)
    .set({ reviewed: true })
    .where(eq(smartImportFiles.importId, importId));
  // Lote com algo aprovado continua aprovado: é o que o livra da limpeza dos 30 dias.
  const approved = items.some((item) => item.status === "gravado");
  await tx
    .update(smartImports)
    .set({ status: approved ? "concluido" : "revisao", updatedAt: new Date() })
    .where(eq(smartImports.id, importId));
  return {
    items: pending.length + created,
    failed: files.filter((file) => file.status === "falhou").length,
    files: files.length,
  };
}

/** A conta do arquivo mudou: a comparação muda junto. O lote volta à fila, sem reler nenhum arquivo. */
export async function requestSmartReview(tx: TenantTx, importId: string): Promise<void> {
  await tx
    .update(smartImports)
    .set({ status: "na_fila", queuedAt: new Date(), updatedAt: new Date() })
    .where(eq(smartImports.id, importId));
}

/** Outro lote da família em leitura agora: cada família lê um por vez. */
export async function otherLotReading(
  tx: TenantTx,
  importId: string,
  now = new Date(),
): Promise<boolean> {
  const [other] = await tx
    .select({ id: smartImports.id })
    .from(smartImports)
    .where(
      and(
        eq(smartImports.status, "lendo"),
        ne(smartImports.id, importId),
        gte(smartImports.updatedAt, new Date(now.getTime() - SMART_STALE_MS)),
      ),
    )
    .limit(1);
  return other !== undefined;
}

export async function listSmartItemsPage(tx: TenantTx, importId: string, page: number) {
  const rows = await tx
    .select({ item: smartImportItems })
    .from(smartImportItems)
    .innerJoin(smartImportFiles, eq(smartImportFiles.id, smartImportItems.fileId))
    .where(eq(smartImportItems.importId, importId))
    .orderBy(
      asc(smartImportFiles.position),
      asc(smartImportItems.destination),
      asc(smartImportItems.position),
    )
    .limit(SMART_REVIEW_PAGE_SIZE)
    .offset(Math.max(page - 1, 0) * SMART_REVIEW_PAGE_SIZE);
  return rows.map((row) => row.item);
}

export interface SmartSummary {
  total: number;
  novo: number;
  possivel: number;
  jaLancado: number;
  blocked: number;
  /** Marcados e vistos: é o que a aprovação grava. */
  ready: number;
  /** Marcados que a pessoa ainda não viu. */
  unseen: number;
  /** O que "Marcar todos" alcança, e quantos disso ela não viu. */
  markable: number;
  markableUnseen: number;
  readyIn: string;
  readyOut: string;
  markableIn: string;
  markableOut: string;
}

const FLOW_AMOUNT = sql`case destination
  when 'lancamento' then (payload->>'amount')::numeric
  when 'compra_cartao' then (payload->>'amount')::numeric
  when 'provento' then coalesce(payload->>'gross', payload->>'net')::numeric
  when 'operacao' then (payload->>'quantity')::numeric * (payload->>'unitPrice')::numeric
  else 0 end`;
const FLOW_IN = sql`(destination = 'provento'
  or (destination = 'lancamento' and payload->>'kind' = 'receita')
  or (destination = 'operacao' and payload->>'side' = 'venda'))`;

/** Totais do lote inteiro, contados no banco: a tela mostra uma página, e a soma vale para todos. */
export async function summarizeSmartItems(
  tx: TenantTx,
  importId: string,
  blockedDestinations: readonly SmartDestination[],
): Promise<SmartSummary> {
  const blocked = blockedDestinations.length
    ? sql`destination in (${sql.join(
        blockedDestinations.map((name) => sql`${name}`),
        sql`, `,
      )})`
    : sql`false`;
  const [row] = await tx.execute<Record<string, string | number | null>>(sql`
    with lot as (
      select *, status <> 'gravado' as open, not (${blocked}) as allowed
      from smart_import_items where import_id = ${importId}
    )
    select
      count(*)::int as total,
      (count(*) filter (where open and duplicate = 'novo'))::int as novo,
      (count(*) filter (where open and duplicate = 'possivel'))::int as possivel,
      (count(*) filter (where open and duplicate = 'ja_lancado'))::int as ja_lancado,
      (count(*) filter (where open and (not allowed or status = 'falhou')))::int as blocked,
      (count(*) filter (where open and allowed and selected and seen))::int as ready,
      (count(*) filter (where open and allowed and selected and not seen))::int as unseen,
      (count(*) filter (where open and allowed))::int as markable,
      (count(*) filter (where open and allowed and not seen))::int as markable_unseen,
      coalesce(sum(${FLOW_AMOUNT}) filter (where open and allowed and selected and seen and ${FLOW_IN}), 0)::text as ready_in,
      coalesce(sum(${FLOW_AMOUNT}) filter (where open and allowed and selected and seen and not ${FLOW_IN}), 0)::text as ready_out,
      coalesce(sum(${FLOW_AMOUNT}) filter (where open and allowed and ${FLOW_IN}), 0)::text as markable_in,
      coalesce(sum(${FLOW_AMOUNT}) filter (where open and allowed and not ${FLOW_IN}), 0)::text as markable_out
    from lot`);
  return {
    total: Number(row?.total ?? 0),
    novo: Number(row?.novo ?? 0),
    possivel: Number(row?.possivel ?? 0),
    jaLancado: Number(row?.ja_lancado ?? 0),
    blocked: Number(row?.blocked ?? 0),
    ready: Number(row?.ready ?? 0),
    unseen: Number(row?.unseen ?? 0),
    markable: Number(row?.markable ?? 0),
    markableUnseen: Number(row?.markable_unseen ?? 0),
    readyIn: toDbAmount(String(row?.ready_in ?? "0")),
    readyOut: toDbAmount(String(row?.ready_out ?? "0")),
    markableIn: toDbAmount(String(row?.markable_in ?? "0")),
    markableOut: toDbAmount(String(row?.markable_out ?? "0")),
  };
}

/** Um aviso por rodada do lote. Sem arquivo pendente, a família vê o que achou. */
export async function notifySmartImport(
  tx: TenantTx,
  householdId: string,
  importId: string,
  counts: { items: number; failed: number; files: number },
): Promise<void> {
  const { message, ...text } = smartImportReadyText(counts);
  await tx
    .insert(householdNotifications)
    .values({
      householdId,
      kind: "importador",
      ...text,
      ...messageColumns(message),
      data: counts,
      href: `/app/importar/arquivos/${importId}`,
      dedupeKey: `importador:${importId}:${counts.items}:${counts.failed}`,
    })
    .onConflictDoNothing();
}

/** Apaga o lote que passou do prazo sem nada aprovado. Lote com aprovação fica, como anexo de dívida. */
export async function purgeSmartImports(tx: TenantTx, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - SMART_RETENTION_DAYS * 86_400_000);
  const rows = await tx
    .delete(smartImports)
    .where(and(ne(smartImports.status, "concluido"), lt(smartImports.createdAt, before)))
    .returning({ id: smartImports.id });
  return rows.length;
}

export async function deleteSmartImport(
  tx: TenantTx,
  ctx: TenantContext,
  id: string,
): Promise<boolean> {
  if (!canWrite(ctx)) return false;
  const rows = await tx
    .delete(smartImports)
    .where(eq(smartImports.id, id))
    .returning({ id: smartImports.id });
  if (rows.length === 0) return false;
  await recordAudit(tx, ctx, "delete", "smart_imports", id);
  return true;
}

/** Campos dos documentos aprovados, para os agentes. O arquivo nunca sai daqui. */
export async function listAttachedDocuments(tx: TenantTx, limit = 30) {
  // Num savepoint: sem a migração ainda, a tabela falta, e a transação de quem chama segue.
  return tx
    .transaction((step) =>
      step
        .select({
          docType: smartImportFiles.docType,
          issuer: smartImportFiles.issuer,
          fields: smartImportFiles.fields,
          attachedAt: smartImportFiles.attachedAt,
        })
        .from(smartImportFiles)
        .where(isNotNull(smartImportFiles.attachedAt))
        .orderBy(desc(smartImportFiles.attachedAt))
        .limit(limit),
    )
    .catch((error: unknown) => {
      if (isSchemaLag(error)) return [];
      throw error;
    });
}
