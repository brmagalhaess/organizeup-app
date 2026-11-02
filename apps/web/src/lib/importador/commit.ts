// Aprovação do importador (ADR-0030): grava o que a pessoa marcou. É dado informado pela família, com aceite
// na tela (regra 7). Cada item na própria transação curta, reconferindo tudo, e o item se marca na mesma
// transação em que grava: repetir não duplica, e erro em um deixa o item inteiro de fora, sem metade. As
// operações de um arquivo gravam juntas, porque a comparação com a carteira olha a nota inteira.
import "server-only";
import {
  createDebtWithSchedule,
  loadSmartKnown,
  saveDebtDocument,
  smartDatesOf,
} from "@organizeup/agents";
import {
  accountCurrency,
  and,
  canWrite,
  cardPurchases,
  cardStatementPayments,
  cashflowPlans,
  categories,
  categoryMemory,
  countEntries,
  creditCards,
  currencyFrozen,
  dividends,
  ensureCategory,
  eq,
  fxQuoteIn,
  goals,
  householdCurrency,
  householdTimezone,
  importBatches,
  incomeSources,
  inArray,
  investments,
  investmentTrades,
  listMarketAssets,
  loadStockEvents,
  markCardPurchase,
  markEntries,
  readFamilyAccess,
  smartImportFiles,
  smartImportItems,
  smartImports,
  sql,
  takeEntries,
  transactions,
  usageMonthOf,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  brazilRulesApply,
  canUse,
  entryFromTyped,
  fitsAmount,
  investmentClassAllowed,
  isForeign,
  linesTotal,
  money,
  merchantKey,
  missingSmartFields,
  newAssetsOf,
  normalizeTicker,
  planInvestmentImport,
  planSmartDuplicates,
  purchaseLines,
  quotaLeft,
  SMART_APPROVAL_CHUNK,
  SMART_DESTINATION_MODULE,
  smartVerdictWorse,
  statementMonthOf,
  todayIn,
  toParsedTrade,
  withResolvedTickers,
  type CatalogAsset,
  type CategoryChoice,
  type DebtPayload,
  type DividendPayload,
  type DocumentPayload,
  type EntryPayload,
  type FamilyAccess,
  type ForecastPayload,
  type GoalPayload,
  type IncomePayload,
  type KnownHolding,
  type PurchasePayload,
  type SmartPayload,
  type TradePayload,
} from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { confirmCommitment, type ImportMark } from "@/lib/confirm-entry";
import { reportActionFailure } from "@/lib/diagnostics";
import { MissingQuote, recordTradeCash } from "@/lib/trade-cash";

type ItemRow = typeof smartImportItems.$inferSelect;

interface FileTarget {
  id: string;
  accountId: string | null;
  cardId: string | null;
}

/** Recusa de um item. O código vira a mensagem na tela, e a transação do item volta inteira. */
class ItemRefused extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

interface Saved {
  table: string | null;
  id: string | null;
}

/** Já estava no sistema: o item fica resolvido, sem gravar de novo. */
const ALREADY: Saved = { table: null, id: null };

async function resolveCategory(
  tx: TenantTx,
  ctx: TenantContext,
  kind: "receita" | "despesa",
  choice: CategoryChoice,
): Promise<string> {
  if (choice.categoryId) {
    const [row] = await tx
      .select({ kind: categories.kind })
      .from(categories)
      .where(eq(categories.id, choice.categoryId));
    if (row?.kind !== kind) throw new ItemRefused("categoria_invalida");
    return choice.categoryId;
  }
  if (!choice.newCategory) throw new ItemRefused("falta_dado");
  const created = await ensureCategory(
    tx,
    ctx.householdId,
    kind,
    choice.newCategory.name,
    choice.newCategory.essential,
  );
  if (created.created) await audit(tx, ctx, "create", "categories", created.id);
  return created.id;
}

async function usableAccount(tx: TenantTx, accountId: string | null) {
  if (!accountId) throw new ItemRefused("falta_dado");
  const currency = await accountCurrency(tx, accountId);
  if (!currency) throw new ItemRefused("conta_invalida");
  if (await currencyFrozen(tx, currency)) throw new ItemRefused("moeda_cancelada");
  return currency;
}

/** Linha no histórico de Importar, com Desfazer. Uma por arquivo e conta. */
async function batchFor(
  tx: TenantTx,
  ctx: TenantContext,
  fileId: string,
  accountId: string,
  source: EntryPayload["source"],
  date: string,
): Promise<string> {
  const id = `arquivo-${fileId}-${accountId}`;
  await tx
    .insert(importBatches)
    .values({
      id,
      householdId: ctx.householdId,
      accountId,
      source,
      rowCount: 1,
      periodStart: date,
      periodEnd: date,
      createdBy: ctx.userId,
    })
    .onConflictDoUpdate({
      target: importBatches.id,
      set: {
        rowCount: sql`${importBatches.rowCount} + 1`,
        periodStart: sql`least(${importBatches.periodStart}, excluded.period_start)`,
        periodEnd: sql`greatest(${importBatches.periodEnd}, excluded.period_end)`,
      },
    });
  return id;
}

async function rememberCategory(
  tx: TenantTx,
  ctx: TenantContext,
  payload: EntryPayload,
  categoryId: string,
) {
  const merchant = merchantKey(payload.description ?? "");
  if (!merchant) return;
  const source = payload.categorySource === null ? ("familia" as const) : ("agente" as const);
  await tx
    .insert(categoryMemory)
    .values({
      householdId: ctx.householdId,
      kind: payload.kind,
      merchant: merchant.slice(0, 120),
      categoryId,
      source,
    })
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

/** Sem impressão digital a baixa acontece igual; só não fica a marca do arquivo. */
const markOf = (fingerprint: string | null, batchId: string): ImportMark | Record<string, never> =>
  fingerprint ? { importFingerprint: fingerprint, importBatchId: batchId } : {};

/**
 * A linha do extrato paga a fatura de outro arquivo do lote. As compras já contam como despesa: gravar a linha
 * contaria de novo. Aqui ela vira a baixa da fatura, depois de as compras estarem gravadas, e só se fechar.
 */
async function settleStatement(
  tx: TenantTx,
  ctx: TenantContext,
  payload: EntryPayload,
  fingerprint: string | null,
  batchId: string,
): Promise<Saved> {
  const rows = await tx
    .select({ payload: smartImportItems.payload })
    .from(smartImportItems)
    .where(
      and(
        eq(smartImportItems.fileId, payload.settlesFileId!),
        eq(smartImportItems.status, "gravado"),
        eq(smartImportItems.destination, "compra_cartao"),
      ),
    );
  const [file] = await tx
    .select({ cardId: smartImportFiles.cardId })
    .from(smartImportFiles)
    .where(eq(smartImportFiles.id, payload.settlesFileId!));
  const cardId = file?.cardId;
  if (rows.length === 0 || !cardId) throw new ItemRefused("fatura_nao_gravada");
  const [card] = await tx.select().from(creditCards).where(eq(creditCards.id, cardId));
  if (!card) throw new ItemRefused("cartao_invalido");
  const months = new Set(
    rows.flatMap(({ payload: row }) =>
      "date" in row && row.date ? [statementMonthOf(row.date, card)] : [],
    ),
  );
  const [month] = months;
  if (months.size !== 1 || !month) throw new ItemRefused("fatura_nao_fecha");
  const purchases = await tx.select().from(cardPurchases).where(eq(cardPurchases.cardId, cardId));
  const lines = purchases
    .flatMap((purchase) => purchaseLines(purchase, card))
    .filter((line) => line.statementMonth === month);
  if (lines.length === 0 || !money(linesTotal(lines)).eq(payload.amount ?? "0")) {
    throw new ItemRefused("fatura_nao_fecha");
  }
  const mark = markOf(fingerprint, batchId);
  const { done } = await confirmCommitment(tx, ctx, `f:${cardId}:${month}`, month, mark);
  if (!done) throw new ItemRefused("fatura_nao_fecha");
  return { table: "card_statement_payments", id: null };
}

async function saveEntry(
  tx: TenantTx,
  ctx: TenantContext,
  payload: EntryPayload,
  file: FileTarget,
  access: FamilyAccess,
): Promise<Saved> {
  const accountId = payload.accountId ?? file.accountId;
  const { date, amount, description } = payload;
  if (!date || !amount || !description) throw new ItemRefused("falta_dado");
  const currency = await usableAccount(tx, accountId);
  const categoryId = await resolveCategory(tx, ctx, payload.kind, payload);
  const main = await householdCurrency(tx);
  const quote = isForeign(currency, main) ? await fxQuoteIn(tx, currency, main, date) : null;
  const entry = entryFromTyped(amount, currency, quote, main);
  if (!entry) throw new ItemRefused("sem_cotacao");
  if (!fitsAmount(entry.amount)) throw new ItemRefused("valor_grande");

  const fingerprint = payload.fingerprint;
  if (fingerprint) {
    const [known] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, accountId!),
          eq(transactions.importFingerprint, fingerprint),
        ),
      );
    if (known) return ALREADY;
  }
  const batchId = await batchFor(tx, ctx, file.id, accountId!, payload.source, date);
  if (payload.settlesFileId) return settleStatement(tx, ctx, payload, fingerprint, batchId);
  if (payload.matchKey) {
    const mark = markOf(fingerprint, batchId);
    const { done } = await confirmCommitment(
      tx,
      ctx,
      payload.matchKey,
      payload.matchMonth ?? "",
      mark,
    );
    if (done) return { table: "transactions", id: null };
  }
  const quota = await takeEntries(tx, access, ctx.householdId, 1);
  if (!quota.ok) throw new ItemRefused("cota");
  const [row] = await tx
    .insert(transactions)
    .values({
      householdId: ctx.householdId,
      accountId: accountId!,
      categoryId,
      kind: payload.kind,
      description,
      ...entry,
      occurredOn: date,
      status: "realizado",
      importFingerprint: fingerprint,
      importBatchId: batchId,
      categorySource:
        payload.categorySource === null
          ? "familia"
          : payload.categorySource === "revisar"
            ? "revisar"
            : "importacao",
      createdBy: ctx.userId,
    })
    .onConflictDoNothing()
    .returning({ id: transactions.id });
  if (!row) return ALREADY;
  await markEntries(tx, quota.month, [row.id]);
  await rememberCategory(tx, ctx, payload, categoryId);
  await audit(tx, ctx, "create", "transactions", row.id);
  return { table: "transactions", id: row.id };
}

async function savePurchase(
  tx: TenantTx,
  ctx: TenantContext,
  payload: PurchasePayload,
  file: FileTarget,
  access: FamilyAccess,
): Promise<Saved> {
  const cardId = payload.cardId ?? file.cardId;
  const { date, amount, description, installments } = payload;
  if (!cardId || !date || !amount || !description) throw new ItemRefused("falta_dado");
  const [card] = await tx.select().from(creditCards).where(eq(creditCards.id, cardId));
  if (!card) throw new ItemRefused("cartao_invalido");
  const categoryId = await resolveCategory(tx, ctx, "despesa", payload);
  const paid = await tx
    .select({ month: cardStatementPayments.statementMonth })
    .from(cardStatementPayments)
    .where(eq(cardStatementPayments.cardId, cardId));
  const months = new Set(paid.map((row) => row.month));
  const lines = purchaseLines(
    { id: "", cardId, categoryId, description, amount, installments, purchasedOn: date },
    card,
  );
  if (lines.some((line) => months.has(line.statementMonth))) throw new ItemRefused("fatura_paga");
  const quota = await takeEntries(tx, access, ctx.householdId, 1);
  if (!quota.ok) throw new ItemRefused("cota");
  const [row] = await tx
    .insert(cardPurchases)
    .values({
      householdId: ctx.householdId,
      cardId,
      categoryId,
      description,
      amount,
      installments,
      purchasedOn: date,
      createdBy: ctx.userId,
    })
    .returning({ id: cardPurchases.id });
  await markCardPurchase(tx, quota.month, row!.id);
  await audit(tx, ctx, "create", "card_purchases", row!.id);
  return { table: "card_purchases", id: row!.id };
}

async function saveDividend(
  tx: TenantTx,
  ctx: TenantContext,
  payload: DividendPayload,
): Promise<Saved> {
  const { ticker, date, gross } = payload;
  if (!ticker || !date || !gross) throw new ItemRefused("falta_dado");
  const holdings = await tx
    .select({ id: investments.id, ticker: investments.ticker })
    .from(investments);
  const holding = holdings.find((row) => normalizeTicker(row.ticker) === ticker);
  if (!holding) throw new ItemRefused("sem_ativo");
  const [known] = await tx
    .select({ id: dividends.id })
    .from(dividends)
    .where(
      and(
        eq(dividends.investmentId, holding.id),
        eq(dividends.paidOn, date),
        eq(dividends.gross, gross),
      ),
    );
  if (known) return ALREADY;
  const [row] = await tx
    .insert(dividends)
    .values({
      householdId: ctx.householdId,
      investmentId: holding.id,
      kind: payload.kind,
      paidOn: date,
      gross,
      withheld: payload.withheld,
      source: "familia",
    })
    .returning({ id: dividends.id });
  await audit(tx, ctx, "create", "dividends", row!.id);
  return { table: "dividends", id: row!.id };
}

/** Consórcio é parcela fixa sem juro a abater: dívida `manual`, com o nome dizendo o que é (ADR-0030). */
async function saveDebt(
  tx: TenantTx,
  ctx: TenantContext,
  payload: DebtPayload,
  file: FileTarget,
): Promise<Saved> {
  const { name, firstDueDate, installments, system } = payload;
  const accountId = payload.accountId ?? file.accountId;
  if (!name || !firstDueDate || !installments || !system) throw new ItemRefused("falta_dado");
  await usableAccount(tx, accountId);
  const manual = system === "manual";
  if (manual ? !payload.installmentAmount : !payload.balance || !payload.monthlyRate) {
    throw new ItemRefused("falta_dado");
  }
  const consortium = payload.destination === "consorcio";
  const debtId = await createDebtWithSchedule(tx, ctx, {
    name: (consortium ? `Consórcio ${name}` : name).slice(0, 80),
    accountId: accountId!,
    terms: {
      system,
      balance: payload.balance ?? "0.00",
      monthlyRate: consortium ? "0" : (payload.monthlyRate ?? "0"),
      installments,
      firstDueDate,
      ...(payload.installmentAmount ? { installmentAmount: payload.installmentAmount } : {}),
    },
  });
  await attachToDebt(tx, ctx, file.id, debtId);
  return { table: "debts", id: debtId };
}

const DEBT_MEDIA_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/** O contrato aparece no cartão da dívida. Sem espaço na cota de dívidas, fica só no lote. */
async function attachToDebt(tx: TenantTx, ctx: TenantContext, fileId: string, debtId: string) {
  const [file] = await tx
    .select({
      fileName: smartImportFiles.fileName,
      mediaType: smartImportFiles.mediaType,
      content: smartImportFiles.content,
    })
    .from(smartImportFiles)
    .where(eq(smartImportFiles.id, fileId));
  if (!file || !DEBT_MEDIA_TYPES.has(file.mediaType)) return;
  await saveDebtDocument(tx, ctx, {
    fileName: file.fileName,
    mediaType: file.mediaType,
    bytes: file.content,
    debtId,
  });
}

async function saveIncome(
  tx: TenantTx,
  ctx: TenantContext,
  payload: IncomePayload,
  file: FileTarget,
): Promise<Saved> {
  const { name, amount, payDay, startMonth } = payload;
  const accountId = payload.accountId ?? file.accountId;
  if (!name || !amount || !payDay || !startMonth) throw new ItemRefused("falta_dado");
  await usableAccount(tx, accountId);
  const categoryId = await resolveCategory(tx, ctx, "receita", payload);
  const [row] = await tx
    .insert(incomeSources)
    .values({
      householdId: ctx.householdId,
      accountId: accountId!,
      categoryId,
      name,
      kind: payload.kind,
      amount,
      isGross: payload.isGross,
      payDay,
      startMonth,
    })
    .returning({ id: incomeSources.id });
  await audit(tx, ctx, "create", "income_sources", row!.id);
  return { table: "income_sources", id: row!.id };
}

async function saveForecast(
  tx: TenantTx,
  ctx: TenantContext,
  payload: ForecastPayload,
  file: FileTarget,
): Promise<Saved> {
  const { description, amount, day, startMonth } = payload;
  const accountId = payload.accountId ?? file.accountId;
  if (!description || !amount || !day || !startMonth) throw new ItemRefused("falta_dado");
  await usableAccount(tx, accountId);
  const categoryId = await resolveCategory(tx, ctx, payload.kind, payload);
  const [row] = await tx
    .insert(cashflowPlans)
    .values({
      householdId: ctx.householdId,
      accountId: accountId!,
      categoryId,
      kind: payload.kind,
      description,
      amount,
      dayOfMonth: day,
      startMonth,
      endMonth: payload.endMonth,
    })
    .returning({ id: cashflowPlans.id });
  await audit(tx, ctx, "create", "cashflow_plans", row!.id);
  return { table: "cashflow_plans", id: row!.id };
}

async function saveGoal(tx: TenantTx, ctx: TenantContext, payload: GoalPayload): Promise<Saved> {
  const { name, targetAmount } = payload;
  if (!name || !targetAmount) throw new ItemRefused("falta_dado");
  const [row] = await tx
    .insert(goals)
    .values({
      householdId: ctx.householdId,
      name,
      kind: payload.kind,
      targetAmount,
      desiredMonth: payload.desiredMonth,
      createdBy: ctx.userId,
    })
    .returning({ id: goals.id });
  await audit(tx, ctx, "create", "goals", row!.id);
  return { table: "goals", id: row!.id };
}

async function saveDocument(
  tx: TenantTx,
  ctx: TenantContext,
  _payload: DocumentPayload,
  file: FileTarget,
): Promise<Saved> {
  await tx
    .update(smartImportFiles)
    .set({ attachedAt: new Date(), updatedAt: new Date() })
    .where(eq(smartImportFiles.id, file.id));
  await audit(tx, ctx, "attach", "smart_import_files", file.id);
  return { table: "smart_import_files", id: file.id };
}

function save(
  tx: TenantTx,
  ctx: TenantContext,
  payload: Exclude<SmartPayload, TradePayload>,
  file: FileTarget,
  access: FamilyAccess,
): Promise<Saved> {
  switch (payload.destination) {
    case "lancamento":
      return saveEntry(tx, ctx, payload, file, access);
    case "compra_cartao":
      return savePurchase(tx, ctx, payload, file, access);
    case "provento":
      return saveDividend(tx, ctx, payload);
    case "divida":
    case "consorcio":
      return saveDebt(tx, ctx, payload, file);
    case "renda":
      return saveIncome(tx, ctx, payload, file);
    case "previsao":
      return saveForecast(tx, ctx, payload, file);
    case "meta":
      return saveGoal(tx, ctx, payload);
    case "documento":
      return saveDocument(tx, ctx, payload, file);
  }
}

const moduleAllowed = (item: Pick<ItemRow, "destination">, access: FamilyAccess) => {
  const owner = SMART_DESTINATION_MODULE[item.destination];
  return owner === null || canUse(access, owner);
};

const markSaved = (tx: TenantTx, ctx: TenantContext, id: string, saved: Saved) =>
  tx
    .update(smartImportItems)
    .set({
      status: "gravado",
      failure: null,
      resultTable: saved.table,
      resultId: saved.id,
      approvedBy: ctx.userId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(smartImportItems.id, id));

const failItems = (tx: TenantTx, ids: string[], failure: string) =>
  tx
    .update(smartImportItems)
    .set({ status: "falhou", failure, updatedAt: new Date() })
    .where(inArray(smartImportItems.id, ids));

const markFailed = (ctx: TenantContext, ids: string[], failure: string) =>
  withHousehold(ctx, (tx) => failItems(tx, ids, failure));

/** A mesma trava da importação da carteira: aprovações da família passam uma de cada vez. */
const lockFamily = (tx: TenantTx, householdId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${householdId}, 7311))`);

/** Só nome e código: a mensagem do banco pode trazer dado da família. */
function codeOf(error: unknown): string {
  if (error instanceof ItemRefused) return error.code;
  if (error instanceof MissingQuote) return "sem_cotacao";
  if (error instanceof RangeError) return "conta_invalida";
  const { name, code } = error as { name?: string; code?: string };
  console.error(JSON.stringify({ level: "error", msg: "smart_import_failed", name, code }));
  reportActionFailure("smart_import_failed", error);
  return "erro_interno";
}

type Outcome = "gravado" | "existia" | "pulado" | "falhou";

interface ChunkContext {
  ctx: TenantContext;
  importId: string;
  files: ReadonlyMap<string, FileTarget & { sha256: string }>;
  access: FamilyAccess;
}

/** O que este lote já gravou não conta como duplicado dele mesmo. */
async function ownResults(tx: TenantTx, importId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ id: smartImportItems.resultId })
    .from(smartImportItems)
    .where(and(eq(smartImportItems.importId, importId), eq(smartImportItems.status, "gravado")));
  return new Set(rows.flatMap((row) => (row.id ? [row.id] : [])));
}

/**
 * Um pedaço do lote numa transação, sob a trava da família: compara de novo com o que está gravado agora e grava.
 * Cada item fica num savepoint, então erro desfaz só ele, inteiro. Dois lotes aprovados juntos passam em fila, e o
 * segundo enxerga o que o primeiro gravou.
 */
async function saveChunk(run: ChunkContext, chunk: ItemRow[]): Promise<Outcome[]> {
  const { ctx, importId, files, access } = run;
  const ids = chunk.map((item) => item.id);
  return withHousehold(ctx, async (tx) => {
    await lockFamily(tx, ctx.householdId);
    const rows = await tx
      .select()
      .from(smartImportItems)
      .where(inArray(smartImportItems.id, ids))
      .for("update");
    const open = rows.filter((row) => row.status !== "gravado");
    const known = await loadSmartKnown(
      tx,
      open.flatMap((row) => smartDatesOf(row.payload)),
      await ownResults(tx, importId),
    );
    const verdicts = planSmartDuplicates(
      open.map(({ id, fileId, payload }) => ({ id, fileId, payload })),
      known,
      {
        shaOf: (id) => files.get(id)?.sha256,
        scope: (id) => ({
          accountId: files.get(id)?.accountId ?? null,
          cardId: files.get(id)?.cardId ?? null,
        }),
      },
    );
    const outcomes: Outcome[] = rows.filter((row) => row.status === "gravado").map(() => "pulado");
    for (const row of open) {
      const file = files.get(row.fileId)!;
      const payload = row.payload as Exclude<SmartPayload, TradePayload>;
      const verdict = verdicts.get(row.id);
      const refused = !moduleAllowed(row, access)
        ? "modulo_desligado"
        : missingSmartFields(payload, file).length > 0
          ? "falta_dado"
          : null;
      if (refused) {
        await failItems(tx, [row.id], refused);
        outcomes.push("falhou");
        continue;
      }
      if (verdict && smartVerdictWorse(row.duplicate, verdict.duplicate)) {
        await tx
          .update(smartImportItems)
          .set({
            status: "falhou",
            failure: "duplicado_agora",
            selected: false,
            duplicate: verdict.duplicate,
            duplicateReason: verdict.reason,
            updatedAt: new Date(),
          })
          .where(eq(smartImportItems.id, row.id));
        outcomes.push("falhou");
        continue;
      }
      try {
        const saved = await tx.transaction(async (step) => {
          const done = await save(step, ctx, payload, file, access);
          await markSaved(step, ctx, row.id, done);
          return done;
        });
        outcomes.push(saved === ALREADY ? "existia" : "gravado");
      } catch (error) {
        await failItems(tx, [row.id], codeOf(error));
        outcomes.push("falhou");
      }
    }
    return outcomes;
  }).catch(async (error: unknown) => {
    await markFailed(ctx, ids, codeOf(error));
    return ids.map(() => "falhou" as const);
  });
}

async function loadHoldings(tx: TenantTx): Promise<KnownHolding[]> {
  const events = await loadStockEvents(tx);
  const [holdings, trades] = await Promise.all([
    tx.select().from(investments),
    tx.select().from(investmentTrades),
  ]);
  return holdings.map((holding) => ({
    id: holding.id,
    name: holding.name,
    ticker: holding.ticker,
    assetClass: holding.assetClass,
    trades: trades.filter((trade) => trade.investmentId === holding.id),
    events: events.filter((event) => event.investmentId === holding.id),
  }));
}

async function createAsset(
  tx: TenantTx,
  ctx: TenantContext,
  ticker: string,
  holdings: KnownHolding[],
  catalog: ReadonlyMap<string, CatalogAsset>,
  today: string,
  currency: Awaited<ReturnType<typeof householdCurrency>>,
) {
  const [asset] = newAssetsOf([{ ticker }], holdings, catalog);
  if (!asset) return null;
  // Fora do catálogo, com final 11, o tipo não dá para deduzir: a tela de Investimentos pergunta.
  if (!asset.assetClass || !investmentClassAllowed(asset.assetClass, currency)) {
    throw new ItemRefused("ativo_sem_tipo");
  }
  const close = catalog.get(ticker)?.close ?? null;
  const [row] = await tx
    .insert(investments)
    .values({
      householdId: ctx.householdId,
      name: asset.name.slice(0, 80),
      ticker,
      assetClass: asset.assetClass,
      ...(close ? { currentPrice: close, valuedOn: today, priceSource: "mercado" as const } : {}),
    })
    .returning({ id: investments.id });
  await audit(tx, ctx, "create", "investments", row!.id);
  return row!.id;
}

/** As operações marcadas de um arquivo, juntas, sob a trava da carteira. A comparação roda de novo aqui. */
async function saveTrades(
  ctx: TenantContext,
  items: ItemRow[],
  catalog: ReadonlyMap<string, CatalogAsset>,
): Promise<Outcome[]> {
  const ids = items.map((item) => item.id);
  try {
    return await withHousehold(ctx, async (tx) => {
      await lockFamily(tx, ctx.householdId);
      const rows = await tx
        .select()
        .from(smartImportItems)
        .where(inArray(smartImportItems.id, ids))
        .for("update");
      const open = rows.filter((row) => row.status !== "gravado");
      if (open.length === 0) return rows.map(() => "pulado" as const);
      const currency = await householdCurrency(tx);
      if (!brazilRulesApply(currency)) throw new ItemRefused("so_brasil");
      const today = todayIn(await householdTimezone(tx, ctx.householdId));
      const holdings = await loadHoldings(tx);
      const parsed = open.map((row) => toParsedTrade(row.payload as TradePayload));
      // A linha liga a proposta à gravação: repetida, a operação de uma viraria a de outra.
      if (new Set(parsed.map((trade) => trade.line)).size !== parsed.length) {
        throw new ItemRefused("linha_repetida");
      }
      const trades = withResolvedTickers(parsed, [...catalog.values(), ...holdings]);
      const lines = new Set(trades.map((trade) => trade.line));
      const plan = planInvestmentImport({ trades, holdings, selected: lines });
      const byLine = new Map(plan.map((row) => [row.line, row]));
      const idOf = new Map(
        holdings.flatMap((holding) => {
          const ticker = normalizeTicker(holding.ticker);
          return ticker ? [[ticker, holding.id] as const] : [];
        }),
      );
      const outcomes: Outcome[] = [];
      for (const row of open) {
        const payload = row.payload as TradePayload;
        const planned = byLine.get(payload.line);
        if (!planned || planned.state === "ignorado") {
          await tx
            .update(smartImportItems)
            .set({
              status: "falhou",
              failure: planned?.ignoreReason ?? "falta_dado",
              updatedAt: new Date(),
            })
            .where(eq(smartImportItems.id, row.id));
          outcomes.push("falhou");
          continue;
        }
        if (planned.state === "existe" || planned.state === "taxas") {
          for (const update of planned.feeUpdates) {
            await tx
              .update(investmentTrades)
              .set({ fees: update.fees })
              .where(eq(investmentTrades.id, update.tradeId));
          }
          await markSaved(tx, ctx, row.id, ALREADY);
          outcomes.push("existia");
          continue;
        }
        if (planned.date > today) throw new ItemRefused("data_futura");
        const ticker = planned.ticker!;
        const investmentId =
          idOf.get(ticker) ??
          (await createAsset(tx, ctx, ticker, holdings, catalog, today, currency));
        if (!investmentId) throw new ItemRefused("sem_ativo");
        idOf.set(ticker, investmentId);
        const trade = {
          side: planned.side,
          occurredOn: planned.date,
          quantity: planned.quantity,
          unitPrice: planned.unitPrice,
          fees: planned.fees,
        };
        const transactionId = payload.accountId
          ? await recordTradeCash(tx, ctx, {
              accountId: payload.accountId,
              side: planned.side,
              name: ticker,
              trade,
            })
          : null;
        const [created] = await tx
          .insert(investmentTrades)
          .values({ householdId: ctx.householdId, investmentId, transactionId, ...trade })
          .returning({ id: investmentTrades.id });
        await markSaved(tx, ctx, row.id, { table: "investment_trades", id: created!.id });
        outcomes.push("gravado");
      }
      await audit(tx, ctx, "import", "investment_trades");
      return outcomes;
    });
  } catch (error) {
    await markFailed(ctx, ids, codeOf(error));
    return ids.map(() => "falhou" as const);
  }
}

export type SmartApproval =
  | { ok: true; saved: number; existed: number; failed: number }
  | { ok: false; code: "somente_leitura" | "nada" | "cota" | "lendo"; left?: number };

const countsAsEntry = (item: ItemRow) =>
  item.destination === "lancamento" || item.destination === "compra_cartao";

const settles = (item: ItemRow) =>
  item.payload.destination === "lancamento" && Boolean(item.payload.settlesFileId);

function chunksOf<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < rows.length; at += size) out.push(rows.slice(at, at + size));
  return out;
}

/** Grava tudo o que está marcado. Falha em um item não para os outros, e repetir só refaz o que falhou. */
export async function approveSmartImport(
  ctx: TenantContext,
  importId: string,
): Promise<SmartApproval> {
  if (!canWrite(ctx)) return { ok: false, code: "somente_leitura" };
  const access = await readFamilyAccess(ctx);
  const loaded = await withHousehold(ctx, async (tx) => {
    const [lot] = await tx
      .select({ status: smartImports.status })
      .from(smartImports)
      .where(eq(smartImports.id, importId));
    if (!lot) return null;
    if (lot.status !== "revisao" && lot.status !== "concluido") return "lendo" as const;
    const items = await tx
      .select()
      .from(smartImportItems)
      .where(
        and(
          eq(smartImportItems.importId, importId),
          eq(smartImportItems.selected, true),
          inArray(smartImportItems.status, ["proposto", "falhou"]),
        ),
      )
      .orderBy(smartImportItems.position);
    const files = await tx
      .select({
        id: smartImportFiles.id,
        accountId: smartImportFiles.accountId,
        cardId: smartImportFiles.cardId,
        position: smartImportFiles.position,
        sha256: smartImportFiles.sha256,
      })
      .from(smartImportFiles)
      .where(eq(smartImportFiles.importId, importId))
      .orderBy(smartImportFiles.position);
    // "Uma importação que passa do limite mostra quantas linhas cabem, e nunca fica pela metade."
    const needed = items.filter((item) => countsAsEntry(item) && !settles(item)).length;
    let left: number | null = null;
    if (access.entryLimit !== null && needed > 0) {
      const month = await usageMonthOf(tx, ctx.householdId);
      left = quotaLeft(await countEntries(tx, month), access.entryLimit);
    }
    return { items, files, needed, left };
  });
  if (loaded === "lendo") return { ok: false, code: "lendo" };
  if (!loaded || loaded.items.length === 0) return { ok: false, code: "nada" };
  const { items, files, needed, left } = loaded;
  if (left !== null && needed > left) return { ok: false, code: "cota", left };

  const counts = { saved: 0, existed: 0, failed: 0 };
  const count = (outcome: Outcome) => {
    if (outcome === "gravado") counts.saved += 1;
    if (outcome === "existia") counts.existed += 1;
    if (outcome === "falhou") counts.failed += 1;
  };
  const trades = items.filter((item) => item.payload.destination === "operacao");
  if (trades.length > 0) {
    const open = trades.filter((item) => {
      if (!moduleAllowed(item, access)) return false;
      return missingSmartFields(item.payload).length === 0;
    });
    const blocked = trades.filter((item) => !open.includes(item));
    for (const item of blocked) {
      const failure = moduleAllowed(item, access) ? "falta_dado" : "modulo_desligado";
      await markFailed(ctx, [item.id], failure);
      count("falhou");
    }
    if (open.length > 0) {
      const catalog = new Map<string, CatalogAsset>(
        (await listMarketAssets()).map((row) => [row.ticker, row]),
      );
      for (const file of files) {
        const group = open.filter((item) => item.fileId === file.id);
        if (group.length > 0) (await saveTrades(ctx, group, catalog)).forEach(count);
      }
    }
  }
  const run: ChunkContext = {
    ctx,
    importId,
    access,
    files: new Map(files.map((file) => [file.id, file])),
  };
  const rest = items.filter((item) => item.payload.destination !== "operacao");
  // Compras primeiro; a baixa da fatura por último, porque ela soma as compras já gravadas.
  const ordered = [
    ...rest.filter((item) => item.destination === "compra_cartao"),
    ...rest.filter((item) => item.destination !== "compra_cartao" && !settles(item)),
  ];
  for (const chunk of chunksOf(ordered, SMART_APPROVAL_CHUNK)) {
    (await saveChunk(run, chunk)).forEach(count);
  }
  const payments = rest.filter(settles);
  if (payments.length > 0) (await saveChunk(run, payments)).forEach(count);
  if (counts.saved + counts.existed > 0) {
    await withHousehold(ctx, async (tx) => {
      await tx
        .update(smartImports)
        .set({ status: "concluido", updatedAt: new Date() })
        .where(eq(smartImports.id, importId));
      await audit(tx, ctx, "approve", "smart_imports", importId);
    });
  }
  return { ok: true, ...counts };
}
