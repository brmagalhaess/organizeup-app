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
  loadStockEvents,
  lt,
  lte,
  ne,
  or,
  smartImportFileMeta,
  smartImportFiles,
  smartImportItems,
  smartImports,
  sql,
  transactions,
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
  planSmartDuplicates,
  SMART_BATCH_MAX_BYTES,
  SMART_DESTINATION_MODULE,
  SMART_FAMILY_MAX_BYTES,
  SMART_MAX_FILES,
  SMART_RETENTION_DAYS,
  SMART_STALE_MS,
  suggestByIssuer,
  yearMonthOf,
  type CategoryChoice,
  type CategoryOption,
  type KnownEntry,
  type SmartItemRef,
  type SmartKnown,
  type SmartPayload,
  type SmartReading,
} from "@organizeup/domain";
import { loadCommitments } from "./commitments";
import { messageColumns, recordAudit } from "./shared";
import { smartImportReadyText } from "./texts";

/** Agente por pedido: não entra na rodada diária, e aparece no painel do serviço. */
export const IMPORTADOR_AGENT = "importador";

export type SmartImportRow = typeof smartImports.$inferSelect;
export type SmartFileMeta = Awaited<ReturnType<typeof listSmartFiles>>[number];
export type SmartItemRow = typeof smartImportItems.$inferSelect;

export async function createSmartImport(tx: TenantTx, ctx: TenantContext): Promise<string | null> {
  if (!canWrite(ctx)) return null;
  const [row] = await tx
    .insert(smartImports)
    .values({ householdId: ctx.householdId, createdBy: ctx.userId })
    .returning({ id: smartImports.id });
  await recordAudit(tx, ctx, "create", "smart_imports", row!.id);
  return row!.id;
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
  | { ok: false; code: "somente_leitura" | "lote" | "muitos" | "cota_lote" | "cota" };

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
 * Volta o arquivo para a fila. O que já foi gravado fica; só as propostas pendentes são refeitas. Pedir para
 * ler de novo é pedir a leitura completa, então o lote passa a aceitar IA: quem barra é o portão.
 */
export async function requeueSmartFile(
  tx: TenantTx,
  ctx: TenantContext,
  fileId: string,
): Promise<string | null> {
  if (!canWrite(ctx)) return null;
  const [file] = await tx
    .update(smartImportFiles)
    .set({ status: "na_fila", failure: null, updatedAt: new Date() })
    .where(and(eq(smartImportFiles.id, fileId), ne(smartImportFiles.status, "lendo")))
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

/** Próximo arquivo, um por vez. Leitura presa, de worker que caiu, volta a valer depois do prazo. */
export async function claimSmartFile(tx: TenantTx, importId: string, now = new Date()) {
  const staleBefore = new Date(now.getTime() - SMART_STALE_MS);
  const [next] = await tx
    .select({ id: smartImportFiles.id })
    .from(smartImportFiles)
    .where(
      and(
        eq(smartImportFiles.importId, importId),
        or(
          eq(smartImportFiles.status, "na_fila"),
          and(eq(smartImportFiles.status, "lendo"), lt(smartImportFiles.updatedAt, staleBefore)),
        ),
      ),
    )
    .orderBy(asc(smartImportFiles.position))
    .limit(1)
    .for("update", { skipLocked: true });
  if (!next) return null;
  const [file] = await tx
    .update(smartImportFiles)
    .set({ status: "lendo", updatedAt: now })
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

/** Rascunho do arquivo. Refazer troca o que estava pendente; o que já foi gravado continua. */
export async function saveSmartReading(tx: TenantTx, input: SmartReadingResult): Promise<void> {
  const { fileId, importId, householdId, reading, method, truncated } = input;
  await tx
    .delete(smartImportItems)
    .where(and(eq(smartImportItems.fileId, fileId), ne(smartImportItems.status, "gravado")));
  const [last] = await tx
    .select({ top: sql<number>`coalesce(max(${smartImportItems.position}), -1)::int` })
    .from(smartImportItems)
    .where(eq(smartImportItems.fileId, fileId));
  const start = (last?.top ?? -1) + 1;
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
      updatedAt: new Date(),
    })
    .where(eq(smartImportFiles.id, fileId));
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

/** Tudo o que a comparação precisa, só do período dos itens. Lê; nada grava. */
export async function loadSmartKnown(tx: TenantTx, dates: string[]): Promise<SmartKnown> {
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
  const realized: KnownEntry[] = inRange
    .filter((row) => row.status === "realizado")
    .map((row) => ({
      key: `t:${row.id}`,
      description: row.description,
      amount: entryOrigin(row)?.amount ?? row.amount,
      date: row.occurredOn,
      kind: row.kind,
      fingerprint: row.importFingerprint,
    }));
  const purchases = await tx
    .select({
      description: cardPurchases.description,
      amount: cardPurchases.amount,
      date: cardPurchases.purchasedOn,
    })
    .from(cardPurchases)
    .where(and(gte(cardPurchases.purchasedOn, from), lte(cardPurchases.purchasedOn, to)));

  const events = await loadStockEvents(tx);
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
    .select({ name: incomeSources.name, amount: incomeSources.amount })
    .from(incomeSources);
  const plans = await tx
    .select({
      description: cashflowPlans.description,
      amount: cashflowPlans.amount,
      kind: cashflowPlans.kind,
    })
    .from(cashflowPlans);
  const goalRows = await tx.select({ name: goals.name }).from(goals);
  const dividendRows = await tx
    .select({
      ticker: investments.ticker,
      date: dividends.paidOn,
      gross: dividends.gross,
    })
    .from(dividends)
    .innerJoin(investments, eq(investments.id, dividends.investmentId));
  const documents = await tx
    .select({ id: smartImportFiles.id, sha256: smartImportFiles.sha256 })
    .from(smartImportFiles)
    .where(isNotNull(smartImportFiles.attachedAt));

  return {
    realized,
    forecasts: await knownForecasts(tx, firstMonth, lastMonth, inRange),
    purchases,
    holdings: holdings.map((holding) => ({
      id: holding.id,
      name: holding.name,
      ticker: holding.ticker,
      assetClass: holding.assetClass,
      trades: trades.filter((trade) => trade.investmentId === holding.id),
      events: events.filter((event) => event.investmentId === holding.id),
    })),
    debts: openDebts.map((debt) => {
      const rows = open.filter((row) => row.debtId === debt.id);
      const next = rows.toSorted((a, b) => a.number - b.number)[0];
      return {
        id: debt.id,
        name: debt.name,
        nextAmount: next?.amount ?? null,
        openInstallments: rows.length,
      };
    }),
    incomes,
    plans,
    goals: goalRows,
    dividends: dividendRows,
    documents: new Map(documents.map((row) => [row.sha256, row.id])),
  };
}

const datesOf = (payload: SmartPayload): string[] => {
  if ("date" in payload && payload.date) return [payload.date];
  return [];
};

/**
 * Compara tudo do lote, escolhe conta e cartão sugeridos e abre a revisão. `freshFiles`: arquivos lidos agora;
 * só neles a seleção volta ao padrão, para não desfazer o que a pessoa já marcou.
 */
export async function reviewSmartImport(
  tx: TenantTx,
  importId: string,
  freshFiles: ReadonlySet<string>,
): Promise<{ items: number; failed: number; files: number }> {
  const files = await listSmartFiles(tx, importId);
  const items = await listSmartItems(tx, importId);
  const pending = items.filter((item) => item.status !== "gravado");
  const order = new Map(files.map((file) => [file.id, file.position]));
  const refs: SmartItemRef[] = pending
    .toSorted((a, b) => order.get(a.fileId)! - order.get(b.fileId)! || a.position - b.position)
    .map(({ id, fileId, payload }) => ({ id, fileId, payload }));
  const known = await loadSmartKnown(
    tx,
    pending.flatMap((item) => datesOf(item.payload)),
  );
  const shaById = new Map(files.map((file) => [file.id, file.sha256]));
  const verdicts = planSmartDuplicates(refs, known, (id) => shaById.get(id));
  const access = await accessWithin(tx);

  for (const item of pending) {
    const verdict = verdicts.get(item.id);
    const destinationModule = SMART_DESTINATION_MODULE[item.destination];
    const allowed = destinationModule === null || canUse(access, destinationModule);
    const duplicate = verdict?.duplicate ?? "novo";
    await tx
      .update(smartImportItems)
      .set({
        duplicate,
        duplicateReason: verdict?.reason ?? null,
        duplicateFileId: verdict?.otherFileId ?? null,
        ...(freshFiles.has(item.fileId) ? { selected: duplicate === "novo" && allowed } : {}),
        ...(item.payload.destination === "lancamento"
          ? {
              payload: {
                ...item.payload,
                matchKey: verdict?.matchKey ?? null,
                matchMonth: verdict?.matchMonth ?? null,
              },
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(smartImportItems.id, item.id));
  }

  const accountRows = await tx
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.archived, false));
  const cardRows = await tx
    .select({ id: creditCards.id, name: creditCards.name })
    .from(creditCards)
    .where(eq(creditCards.archived, false));
  for (const file of files) {
    if (!freshFiles.has(file.id) || file.status !== "lido") continue;
    await tx
      .update(smartImportFiles)
      .set({
        accountId: file.accountId ?? suggestByIssuer(file.issuer, accountRows),
        cardId: file.cardId ?? suggestByIssuer(file.issuer, cardRows),
      })
      .where(eq(smartImportFiles.id, file.id));
  }
  // Lote com algo aprovado continua aprovado: é o que o livra da limpeza dos 30 dias.
  const approved = items.some((item) => item.status === "gravado");
  await tx
    .update(smartImports)
    .set({ status: approved ? "concluido" : "revisao", updatedAt: new Date() })
    .where(eq(smartImports.id, importId));
  return {
    items: pending.length,
    failed: files.filter((file) => file.status === "falhou").length,
    files: files.length,
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
