// Agente diário de categorias (ADR-0015). Revisa os lançamentos dos últimos 90 dias: o que ficou
// "para revisar" em Outras e a regra conhece muda sozinho (com Desfazer); o resto vira sugestão.
import {
  and,
  cardPurchases,
  cashflowPlans,
  categories,
  categoryMemory,
  categoryTemplates,
  desc,
  ensureCategory,
  eq,
  gte,
  householdReports,
  inArray,
  sql,
  transactions,
  type TenantTx,
} from "@organizeup/db";
import {
  dailyCategoryReport,
  isFallbackCategory,
  memoryKey,
  merchantKey,
  normalizeDescription,
  reviewCategories,
  suggestCategoryMerges,
  type CategoryMerge,
  type MergeCategoryOption,
  type ReportCategoriasIa,
  type ReviewGroup,
  type ReviewTransaction,
} from "@organizeup/domain";
import { DEDUPE, type CategoriaPayload, type FusaoCategoriaPayload } from "./suggestions";
import {
  loadDecisions,
  plural,
  recordApplied,
  recordAudit,
  REVIEW_DAYS,
  saveDailyReport,
  shiftDays,
  systemActor,
  upsertPending,
  type AgentInput,
  type AgentResult,
  type PendingSuggestion,
} from "./shared";

export const CATEGORIAS_AGENT = "categorias";

const quote = (name: string) => `‘${name}’`;

export async function runCategoriasAgent(tx: TenantTx, input: AgentInput): Promise<AgentResult> {
  const { today, householdId } = input;
  const since = shiftDays(today, -REVIEW_DAYS);

  const categoryRows = await tx.select().from(categories);
  const nameOf = new Map(categoryRows.map((c) => [c.id, c.name]));
  const recent = await tx
    .select({
      id: transactions.id,
      kind: transactions.kind,
      description: transactions.description,
      categoryId: transactions.categoryId,
      categorySource: transactions.categorySource,
      importBatchId: transactions.importBatchId,
    })
    .from(transactions)
    .where(gte(transactions.occurredOn, since))
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt));
  const reviewRows: ReviewTransaction[] = recent.map((row) => ({
    ...row,
    categoryName: nameOf.get(row.categoryId) ?? "",
  }));

  // Memória: o que a família já fez (lançamentos fora de Outras), o que ela confirmou em
  // importações e o que o agente aprendeu sozinho (este só sugere).
  const older = await tx
    .select({
      kind: transactions.kind,
      description: transactions.description,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
    .limit(1000);
  const history = new Map<string, string>();
  for (const row of older) {
    if (isFallbackCategory(nameOf.get(row.categoryId) ?? "")) continue;
    const key = memoryKey(row.kind, merchantKey(row.description));
    if (!history.has(key)) history.set(key, row.categoryId);
  }
  const remembered = await tx.select().from(categoryMemory);
  const learned = new Map<string, string>();
  const agentLearned = new Map<string, string>();
  for (const row of remembered) {
    const key = memoryKey(row.kind, row.merchant);
    if (row.source === "familia") learned.set(key, row.categoryId);
    else agentLearned.set(key, row.categoryId);
  }

  const decisions = await loadDecisions(tx, today, CATEGORIAS_AGENT);
  const usable = categoryRows
    .filter((c) => !c.archived)
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
  const review = reviewCategories({
    transactions: reviewRows,
    categories: usable,
    memory: { history, learned },
    agentLearned,
    blocked: decisions.blocked,
  });

  // 1. Automáticos: aplica, registra como `aplicada` por `agente` e guarda o anterior para desfazer.
  const created: string[] = [];
  let applied = 0;
  const current = new Map(reviewRows.map((row) => [row.id, row]));
  for (const group of review.automatic) {
    const target = await applyGroup(tx, householdId, group, current, nameOf, created);
    if (target) applied += group.ids.length;
  }

  // 2. Sugeridos: ficam pendentes até a família decidir.
  const pending = review.suggested.map((group) => pendingOf(group, nameOf));

  // 3. Fusões de categorias parecidas: sempre sugestão.
  const merges = await suggestMerges(tx, categoryRows, recent);
  for (const merge of merges.items) {
    pending.push(merge);
  }
  const suggestions = await upsertPending(tx, householdId, CATEGORIAS_AGENT, decisions, pending);

  // Esta revisão pode rodar de novo no dia: o que a etapa de IA já relatou continua no relatório.
  const report = dailyCategoryReport(review, merges.merges, {
    reviewed: reviewRows.length,
    created,
    day: today,
    ...(await todayAiReport(tx, today)),
  });
  await saveDailyReport(tx, householdId, CATEGORIAS_AGENT, "categorias", today, report);
  return { suggestions, applied, report: { ...report, data: { ...report.data } } };
}

async function todayAiReport(tx: TenantTx, today: string): Promise<{ ia?: ReportCategoriasIa }> {
  const [row] = await tx
    .select({ data: householdReports.data })
    .from(householdReports)
    .where(and(eq(householdReports.kind, "categorias"), eq(householdReports.period, today)));
  const ia = (row?.data as { ia?: ReportCategoriasIa } | undefined)?.ia;
  return ia ? { ia } : {};
}

/**
 * Muda um grupo sozinho, registra como `aplicada` por `agente`, com o estado anterior para desfazer,
 * e guarda na memória. Devolve a categoria de destino, ou null se o grupo não tem destino.
 */
export async function applyGroup(
  tx: TenantTx,
  householdId: string,
  group: ReviewGroup,
  current: Map<string, Pick<ReviewTransaction, "categoryId" | "categorySource">>,
  nameOf: Map<string, string>,
  created: string[],
): Promise<string | null> {
  const resolved = await resolveTarget(tx, householdId, group, created);
  if (!resolved) return null;
  const { id: target, isNew } = resolved;
  const previous = group.ids.flatMap((id) => {
    const row = current.get(id);
    return row
      ? [{ transactionId: id, categoryId: row.categoryId, categorySource: row.categorySource }]
      : [];
  });
  await tx
    .update(transactions)
    .set({ categoryId: target, categorySource: "agente", updatedAt: new Date() })
    .where(inArray(transactions.id, group.ids));
  await rememberAsAgent(tx, householdId, group.kind, group.merchant, target);
  const toName = nameOf.get(target) ?? group.newCategory?.name ?? "";
  const payload: CategoriaPayload = {
    kind: group.kind,
    transactionIds: group.ids,
    fromCategoryId: group.fromCategoryId,
    toCategoryId: target,
    newCategory: group.newCategory,
    merchant: group.merchant,
    reason: group.reason,
    previous,
    appliedCategoryId: target,
    ...(isNew ? { createdCategoryId: target } : {}),
  };
  const id = await recordApplied(tx, householdId, CATEGORIAS_AGENT, {
    kind: "categoria",
    title: `Movemos ${plural(group.ids.length, "lançamento", "lançamentos")} de ${quote(
      nameOf.get(group.fromCategoryId) ?? "Outras",
    )} para ${quote(toName)}`,
    body:
      `${group.reason}. Se não fizer sentido, use Desfazer: o assistente devolve os lançamentos ` +
      `e não mexe mais neles.`,
    payload,
    dedupeKey: group.dedupeKey,
  });
  await recordAudit(tx, systemActor(householdId), "agente:categoria", "household_suggestions", id, {
    transactions: group.ids.length,
  });
  return target;
}

/** Sugestão pendente de um grupo: fica na fila até a família decidir. */
export function pendingOf(group: ReviewGroup, nameOf: Map<string, string>): PendingSuggestion {
  const toName = group.toCategoryId
    ? (nameOf.get(group.toCategoryId) ?? "")
    : (group.newCategory?.name ?? "");
  const payload: CategoriaPayload = {
    kind: group.kind,
    transactionIds: group.ids,
    fromCategoryId: group.fromCategoryId,
    toCategoryId: group.toCategoryId,
    newCategory: group.newCategory,
    merchant: group.merchant,
    reason: group.reason,
  };
  return {
    kind: "categoria",
    title: `Mover ${plural(group.ids.length, "lançamento", "lançamentos")} para ${quote(toName)}?`,
    body:
      `${group.reason}. Hoje ${group.ids.length === 1 ? "está" : "estão"} em ` +
      `${quote(nameOf.get(group.fromCategoryId) ?? "")}. Aceitar move e o assistente passa a ` +
      `usar ${quote(toName)} para este estabelecimento.`,
    payload,
    dedupeKey: group.dedupeKey,
  };
}

/** Categoria de destino de um grupo: a existente ou a criada agora (nome igual reaproveita). */
async function resolveTarget(
  tx: TenantTx,
  householdId: string,
  group: ReviewGroup,
  created: string[],
): Promise<{ id: string; isNew: boolean } | null> {
  if (group.toCategoryId) return { id: group.toCategoryId, isNew: false };
  if (!group.newCategory) return null;
  const result = await ensureCategory(
    tx,
    householdId,
    group.kind,
    group.newCategory.name,
    group.newCategory.essential,
  );
  if (result.created) created.push(group.newCategory.name);
  return { id: result.id, isNew: result.created };
}

/** Memória do agente para o estabelecimento; nunca sobrescreve o que a família confirmou. */
async function rememberAsAgent(
  tx: TenantTx,
  householdId: string,
  kind: "receita" | "despesa",
  merchant: string,
  categoryId: string,
): Promise<void> {
  if (!merchant) return;
  await tx
    .insert(categoryMemory)
    .values({ householdId, kind, merchant: merchant.slice(0, 120), categoryId, source: "agente" })
    .onConflictDoUpdate({
      target: [categoryMemory.householdId, categoryMemory.kind, categoryMemory.merchant],
      set: {
        categoryId: sql`case when ${categoryMemory.source} = 'familia' then ${categoryMemory.categoryId} else excluded.category_id end`,
        hits: sql`${categoryMemory.hits} + 1`,
        updatedAt: new Date(),
      },
    });
}

async function suggestMerges(
  tx: TenantTx,
  categoryRows: Array<{ id: string; name: string; kind: "receita" | "despesa"; archived: boolean }>,
  recent: Array<{ categoryId: string }>,
): Promise<{ merges: CategoryMerge[]; items: PendingSuggestion[] }> {
  const templates = await tx
    .select({ name: categoryTemplates.name, kind: categoryTemplates.kind })
    .from(categoryTemplates);
  const templateKeys = new Set(templates.map((t) => `${t.kind}:${normalizeDescription(t.name)}`));
  const options: MergeCategoryOption[] = categoryRows.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    archived: c.archived,
    template: templateKeys.has(`${c.kind}:${normalizeDescription(c.name)}`),
  }));
  const counts = new Map<string, number>();
  for (const row of recent) counts.set(row.categoryId, (counts.get(row.categoryId) ?? 0) + 1);
  const merges = suggestCategoryMerges(
    options,
    [...counts.entries()].map(([categoryId, count]) => ({ categoryId, count })),
  );
  if (merges.length === 0) return { merges, items: [] };

  const nameOf = new Map(categoryRows.map((c) => [c.id, c.name]));
  const fromIds = merges.map((merge) => merge.fromCategoryId);
  const [txRows, planRows, purchaseRows] = await Promise.all([
    tx
      .select({ id: transactions.id, categoryId: transactions.categoryId })
      .from(transactions)
      .where(inArray(transactions.categoryId, fromIds)),
    tx
      .select({ id: cashflowPlans.id, categoryId: cashflowPlans.categoryId })
      .from(cashflowPlans)
      .where(inArray(cashflowPlans.categoryId, fromIds)),
    tx
      .select({ id: cardPurchases.id, categoryId: cardPurchases.categoryId })
      .from(cardPurchases)
      .where(inArray(cardPurchases.categoryId, fromIds)),
  ]);
  const idsOf = (rows: Array<{ id: string; categoryId: string }>, categoryId: string) =>
    rows.filter((row) => row.categoryId === categoryId).map((row) => row.id);
  const items = merges.map((merge): PendingSuggestion => {
    const from = nameOf.get(merge.fromCategoryId) ?? "";
    const to = nameOf.get(merge.toCategoryId) ?? "";
    const payload: FusaoCategoriaPayload = {
      fromCategoryId: merge.fromCategoryId,
      toCategoryId: merge.toCategoryId,
      transactionIds: idsOf(txRows, merge.fromCategoryId),
      planIds: idsOf(planRows, merge.fromCategoryId),
      purchaseIds: idsOf(purchaseRows, merge.fromCategoryId),
      reason: merge.reason,
    };
    return {
      kind: "fusao_categoria",
      title: `Juntar ${quote(from)} com ${quote(to)}?`,
      body:
        `${merge.reason}. Aceitar move lançamentos, previsões e compras de ${quote(from)} para ` +
        `${quote(to)} e arquiva ${quote(from)}. Dá para desfazer depois.`,
      payload,
      dedupeKey: DEDUPE.fusao(merge.fromCategoryId, merge.toCategoryId),
    };
  });
  return { merges, items };
}
