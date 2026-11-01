// Agente diário de categorias (ADR-0015). Revisa os lançamentos dos últimos 90 dias e muda sozinho o que
// está em categoria genérica, junta categorias quase iguais e resolve as sugestões antigas. Nada vira
// pergunta: cada mudança fica registrada, com Desfazer, e aparece em Notificações.
import {
  and,
  categories,
  categoryMemory,
  categoryTemplates,
  desc,
  ensureCategory,
  eq,
  gte,
  householdReports,
  householdSuggestions,
  inArray,
  sql,
  transactions,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  dailyCategoryReport,
  isCategoryCandidate,
  isCategoryTarget,
  memoryKey,
  merchantKey,
  merchantsOfDedupeKeys,
  money,
  normalizeDescription,
  reviewCategories,
  suggestCategoryMerges,
  toDbAmount,
  validNewCategoryName,
  type CategoryMerge,
  type MergeCategoryOption,
  type ReportCategoriasIa,
  type ReviewGroup,
  type ReviewTransaction,
} from "@organizeup/domain";
import { applyFusao } from "./apply";
import { notifyCategoryChange, type NotificationScope } from "./notifications";
import {
  AI_CATEGORY_REASON,
  AUTOMATIC_SUGGESTION_KINDS,
  categoriaPayloadSchema,
  DEDUPE,
  fusaoCategoriaPayloadSchema,
  parsePayload,
  type CategoriaPayload,
  type FusaoCategoriaPayload,
} from "./suggestions";
import {
  closePending,
  loadDecisions,
  markApplied,
  plural,
  recordApplied,
  recordAudit,
  REVIEW_DAYS,
  saveDailyReport,
  shiftDays,
  systemActor,
  type AgentInput,
  type AgentResult,
  type Decisions,
} from "./shared";

export const CATEGORIAS_AGENT = "categorias";

const quote = (name: string) => `‘${name}’`;

type CategoryRow = typeof categories.$inferSelect;

export async function runCategoriasAgent(tx: TenantTx, input: AgentInput): Promise<AgentResult> {
  const { today, householdId } = input;
  const since = shiftDays(today, -REVIEW_DAYS);
  const scope = { householdId, today };
  const decisions = await loadDecisions(tx, today);
  const created: string[] = [];

  // 1. Sugestões de antes da decisão de 2026-11-01: aplica o que a regra deixa e fecha o resto.
  const resolved = await resolvePending(tx, scope, decisions, created);

  // 2. Fusões antes da revisão: nenhum lançamento pode ir hoje para uma categoria que vai sair.
  const usage = await tx
    .select({ categoryId: transactions.categoryId })
    .from(transactions)
    .where(gte(transactions.occurredOn, since));
  const merges = await applyMerges(tx, scope, decisions, await tx.select().from(categories), usage);

  const categoryRows = await tx.select().from(categories);
  const nameOf = new Map(categoryRows.map((c) => [c.id, c.name]));
  const recent = await tx
    .select({
      id: transactions.id,
      kind: transactions.kind,
      description: transactions.description,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      categorySource: transactions.categorySource,
      importBatchId: transactions.importBatchId,
    })
    .from(transactions)
    .where(gte(transactions.occurredOn, since))
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt));
  const reviewRows = recent.map((row) => ({
    ...row,
    categoryName: nameOf.get(row.categoryId) ?? "",
  }));

  // Memória: o que já foi classificado de verdade, o que a família confirmou em importações e o que
  // o agente aprendeu sozinho.
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
    if (!isCategoryTarget(nameOf.get(row.categoryId) ?? "")) continue;
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

  const usable = categoryRows
    .filter((c) => !c.archived)
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
  const review = reviewCategories({
    transactions: reviewRows,
    categories: usable,
    memory: { history, learned },
    agentLearned,
    blocked: decisions.blocked,
    ignored: decisions.recentlyIgnored,
  });

  // 3. Aplica, registra como `aplicada` por `agente`, guarda o anterior e avisa em Notificações.
  let moved = resolved.moved;
  const current = new Map(reviewRows.map((row) => [row.id, row]));
  for (const group of review.automatic) {
    const target = await applyGroup(tx, scope, group, current, nameOf, created);
    if (target) moved += group.ids.length;
  }

  // Esta revisão pode rodar de novo no dia: o que a etapa de IA já relatou continua no relatório.
  const report = dailyCategoryReport({
    reviewed: reviewRows.length,
    moved,
    merges: resolved.merges + merges,
    created,
    day: today,
    ...(await todayAiReport(tx, today)),
  });
  await saveDailyReport(tx, householdId, CATEGORIAS_AGENT, "categorias", today, report);
  return {
    suggestions: 0,
    applied: moved + resolved.merges + merges,
    report: { ...report, data: { ...report.data } },
  };
}

async function todayAiReport(tx: TenantTx, today: string): Promise<{ ia?: ReportCategoriasIa }> {
  const [row] = await tx
    .select({ data: householdReports.data })
    .from(householdReports)
    .where(and(eq(householdReports.kind, "categorias"), eq(householdReports.period, today)));
  const ia = (row?.data as { ia?: ReportCategoriasIa } | undefined)?.ia;
  return ia ? { ia } : {};
}

export interface ChangeScope extends NotificationScope {
  /** Quem registra a mudança. O agente da conversa passa o dele. */
  agent?: string;
  /** Quem aparece na auditoria. Sem isso, o sistema. */
  actor?: Pick<TenantContext, "householdId" | "userId" | "role">;
  /** Sugestão antiga que esta mudança resolve, na mesma linha. */
  pendingId?: string;
}

type CurrentRow = Pick<ReviewTransaction, "categoryId" | "categorySource"> & { amount: string };

/** Nomes das categorias de antes, da mais comum para a menos comum. */
function namesBefore(rows: CurrentRow[], nameOf: Map<string, string>, fallback: string): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = nameOf.get(row.categoryId) ?? fallback;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

const totalOf = (rows: Array<{ amount: string }>) =>
  toDbAmount(rows.reduce((sum, row) => sum.plus(row.amount), money(0)));

/** A linha `aplicada` de hoje para esta mudança, se a noite já mexeu neste estabelecimento e destino. */
async function appliedToday(tx: TenantTx, today: string, dedupeKey: string) {
  const [row] = await tx
    .select({ id: householdSuggestions.id, payload: householdSuggestions.payload })
    .from(householdSuggestions)
    .where(
      and(
        eq(householdSuggestions.dedupeKey, dedupeKey.slice(0, 160)),
        eq(householdSuggestions.status, "aplicada"),
        eq(householdSuggestions.appliedBy, "agente"),
        sql`${householdSuggestions.payload}->>'day' = ${today}`,
      ),
    );
  return row ?? null;
}

/**
 * Muda um grupo sozinho, registra como `aplicada` por `agente`, com o estado anterior para desfazer,
 * guarda na memória e avisa em Notificações. Devolve a categoria de destino, ou null se não há destino.
 */
export async function applyGroup(
  tx: TenantTx,
  scope: ChangeScope,
  group: ReviewGroup,
  current: Map<string, CurrentRow>,
  nameOf: Map<string, string>,
  created: string[],
): Promise<string | null> {
  const { householdId, today } = scope;
  const resolved = await resolveTarget(tx, householdId, group, created);
  if (!resolved) return null;
  const { id: target, isNew } = resolved;
  const rows = group.ids.flatMap((id) => {
    const row = current.get(id);
    return row ? [{ ...row, id }] : [];
  });
  if (rows.length === 0) return null;
  const previous = rows.map((row) => ({
    transactionId: row.id,
    categoryId: row.categoryId,
    categorySource: row.categorySource,
  }));
  await tx
    .update(transactions)
    .set({ categoryId: target, categorySource: "agente", updatedAt: new Date() })
    .where(
      inArray(
        transactions.id,
        rows.map((row) => row.id),
      ),
    );
  await rememberAsAgent(tx, householdId, group.kind, group.merchant, target);

  const toName = nameOf.get(target) ?? group.newCategory?.name ?? "";
  const fromName = nameOf.get(group.fromCategoryId) ?? "Outras";
  const line = {
    type: "alteracao" as const,
    merchant: group.merchant,
    kind: group.kind,
    count: rows.length,
    total: totalOf(rows),
    fromNames: namesBefore(rows, nameOf, fromName),
    toName,
    isNew,
  };
  const earlier = scope.pendingId ? null : await appliedToday(tx, today, group.dedupeKey);
  const before = earlier ? parsePayload("categoria", earlier.payload) : null;
  const allIds = [...(before?.transactionIds ?? []), ...rows.map((row) => row.id)];
  const createdId = isNew ? target : before?.createdCategoryId;
  const payload: CategoriaPayload = {
    kind: group.kind,
    transactionIds: allIds,
    fromCategoryId: group.fromCategoryId,
    toCategoryId: target,
    newCategory: group.newCategory,
    merchant: group.merchant,
    reason: group.reason,
    previous: [...(before?.previous ?? []), ...previous],
    appliedCategoryId: target,
    day: today,
    ...(createdId ? { createdCategoryId: createdId } : {}),
  };
  const item = {
    kind: "categoria" as const,
    title: `Movemos ${plural(allIds.length, "lançamento", "lançamentos")} de ${quote(
      fromName,
    )} para ${quote(toName)}`,
    body:
      `${group.reason}. Se não fizer sentido, use Desfazer: o assistente devolve os lançamentos ` +
      `e não mexe mais neles.`,
    payload,
    dedupeKey: group.dedupeKey,
  };
  const suggestionId = scope.pendingId ?? earlier?.id ?? null;
  const id =
    suggestionId ?? (await recordApplied(tx, householdId, scope.agent ?? CATEGORIAS_AGENT, item));
  if (suggestionId) await markApplied(tx, suggestionId, item);
  await recordAudit(
    tx,
    scope.actor ?? systemActor(householdId),
    "agente:categoria",
    "household_suggestions",
    id,
    { transactions: rows.length },
  );
  await notifyCategoryChange(tx, scope, {
    suggestionId: id,
    key: group.dedupeKey,
    line,
    merged: earlier !== null,
  });
  return target;
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

// ---------- fusão de categorias ----------

/** Par que o agente pode juntar: dois lados ativos, do mesmo tipo, fora do sistema e não desfeito. */
function mergeAllowed(
  from: CategoryRow | undefined,
  to: CategoryRow | undefined,
  decisions: Decisions,
): boolean {
  if (!from || !to || from.kind !== to.kind || from.archived || to.archived) return false;
  if (!isCategoryTarget(from.name) || !isCategoryTarget(to.name)) return false;
  // Desfeita nos dois sentidos: com o uso, a categoria mais usada pode virar a outra.
  const pair = [DEDUPE.fusao(from.id, to.id), DEDUPE.fusao(to.id, from.id)];
  return !pair.some((key) => decisions.blocked.has(key) || decisions.recentlyIgnored.has(key));
}

/** Junta as duas categorias, registra com o que foi movido e avisa em Notificações. */
async function applyMerge(
  tx: TenantTx,
  scope: ChangeScope,
  from: CategoryRow,
  to: CategoryRow,
  reason?: string,
): Promise<boolean> {
  const empty = { transactionIds: [], planIds: [], purchaseIds: [] };
  const outcome = await applyFusao(tx, {
    fromCategoryId: from.id,
    toCategoryId: to.id,
    ...empty,
    ...(reason ? { reason } : {}),
  });
  if ("error" in outcome) return false;
  const moved = outcome.payload.moved!;
  const payload: FusaoCategoriaPayload = {
    ...outcome.payload,
    transactionIds: moved.transactionIds,
    planIds: moved.planIds,
    purchaseIds: moved.purchaseIds,
  };
  const dedupeKey = DEDUPE.fusao(from.id, to.id);
  const item = {
    kind: "fusao_categoria" as const,
    title: `Juntamos ${quote(from.name)} com ${quote(to.name)}`,
    body:
      `${reason ? `${reason}. ` : ""}Lançamentos, previsões e compras foram para ${quote(to.name)}, ` +
      `e ${quote(from.name)} foi arquivada. Se não fizer sentido, use Desfazer.`,
    payload,
    dedupeKey,
  };
  const { householdId } = scope;
  const id = scope.pendingId ?? (await recordApplied(tx, householdId, CATEGORIAS_AGENT, item));
  if (scope.pendingId) await markApplied(tx, scope.pendingId, item);
  await recordAudit(
    tx,
    systemActor(householdId),
    "agente:fusao_categoria",
    "household_suggestions",
    id,
    { transactions: moved.transactionIds.length },
  );
  const rows =
    moved.transactionIds.length === 0
      ? []
      : await tx
          .select({ amount: transactions.amount })
          .from(transactions)
          .where(inArray(transactions.id, moved.transactionIds));
  await notifyCategoryChange(tx, scope, {
    suggestionId: id,
    key: dedupeKey,
    merged: false,
    line: {
      type: "fusao",
      count: rows.length,
      total: totalOf(rows),
      fromNames: [from.name],
      toName: to.name,
    },
  });
  return true;
}

/** Junta o que a revisão acha parecido. Devolve quantas fusões aconteceram. */
async function applyMerges(
  tx: TenantTx,
  scope: ChangeScope,
  decisions: Decisions,
  categoryRows: CategoryRow[],
  recent: Array<{ categoryId: string }>,
): Promise<number> {
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
  const merges: CategoryMerge[] = suggestCategoryMerges(
    options,
    [...counts.entries()].map(([categoryId, count]) => ({ categoryId, count })),
  );

  const byId = new Map(categoryRows.map((c) => [c.id, c]));
  let done = 0;
  for (const merge of merges) {
    const from = byId.get(merge.fromCategoryId);
    const to = byId.get(merge.toCategoryId);
    if (!mergeAllowed(from, to, decisions)) continue;
    if (await applyMerge(tx, scope, from!, to!, merge.reason)) done += 1;
  }
  return done;
}

// ---------- sugestões de antes da decisão de 2026-11-01 ----------

/**
 * Sugestão pendente de categoria passa pela regra de hoje: muda o que pode mudar, com Desfazer e aviso,
 * e o resto fecha sem efeito. A etapa de IA não guardou a confiança na sugestão: as dela fecham, e o
 * modelo avalia o estabelecimento de novo, na mesma noite, pela regra nova.
 */
async function resolvePending(
  tx: TenantTx,
  scope: NotificationScope,
  decisions: Decisions,
  created: string[],
): Promise<{ moved: number; merges: number }> {
  const pending = await tx
    .select()
    .from(householdSuggestions)
    .where(
      and(
        eq(householdSuggestions.status, "pendente"),
        inArray(householdSuggestions.kind, [...AUTOMATIC_SUGGESTION_KINDS]),
      ),
    );
  const totals = { moved: 0, merges: 0 };
  if (pending.length === 0) return totals;

  const categoryRows = await tx.select().from(categories);
  const blocked = merchantsOfDedupeKeys(decisions.blocked);
  for (const row of pending) {
    if (row.kind === "fusao_categoria") {
      const merged = await resolvePendingMerge(tx, scope, decisions, row, categoryRows);
      if (merged) totals.merges += 1;
      continue;
    }
    const moved = await resolvePendingChange(tx, scope, blocked, row, categoryRows, created);
    totals.moved += moved;
  }
  return totals;
}

async function resolvePendingChange(
  tx: TenantTx,
  scope: NotificationScope,
  blocked: ReadonlySet<string>,
  row: typeof householdSuggestions.$inferSelect,
  categoryRows: CategoryRow[],
  created: string[],
): Promise<number> {
  const parsed = categoriaPayloadSchema.safeParse(row.payload);
  const payload = parsed.success ? parsed.data : null;
  const target = payload?.toCategoryId
    ? categoryRows.find((c) => c.id === payload.toCategoryId)
    : undefined;
  const validTarget = payload?.toCategoryId
    ? target !== undefined &&
      !target.archived &&
      target.kind === payload.kind &&
      isCategoryTarget(target.name)
    : validNewCategoryName(payload?.newCategory?.name ?? "");
  if (
    !payload ||
    !validTarget ||
    payload.reason === AI_CATEGORY_REASON ||
    blocked.has(memoryKey(payload.kind, payload.merchant))
  ) {
    await closePending(tx, row.id, row.dedupeKey);
    return 0;
  }

  const nameOf = new Map(categoryRows.map((c) => [c.id, c.name]));
  const rows = await tx
    .select({
      id: transactions.id,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      categorySource: transactions.categorySource,
      importBatchId: transactions.importBatchId,
    })
    .from(transactions)
    .where(inArray(transactions.id, payload.transactionIds));
  const eligible = rows.filter(
    (item) =>
      item.categoryId !== payload.toCategoryId &&
      isCategoryCandidate({ ...item, categoryName: nameOf.get(item.categoryId) ?? "" }),
  );
  if (eligible.length === 0) {
    await closePending(tx, row.id, row.dedupeKey);
    return 0;
  }
  const applied = await applyGroup(
    tx,
    { ...scope, pendingId: row.id },
    {
      ids: eligible.map((item) => item.id),
      kind: payload.kind,
      merchant: payload.merchant,
      fromCategoryId: payload.fromCategoryId,
      toCategoryId: payload.toCategoryId,
      newCategory: payload.newCategory,
      reason: payload.reason ?? "A regra conhece o estabelecimento",
      dedupeKey: row.dedupeKey,
    },
    new Map(eligible.map((item) => [item.id, item])),
    nameOf,
    created,
  );
  return applied ? eligible.length : 0;
}

async function resolvePendingMerge(
  tx: TenantTx,
  scope: NotificationScope,
  decisions: Decisions,
  row: typeof householdSuggestions.$inferSelect,
  categoryRows: CategoryRow[],
): Promise<boolean> {
  const parsed = fusaoCategoriaPayloadSchema.safeParse(row.payload);
  const from = categoryRows.find((c) => c.id === parsed.data?.fromCategoryId);
  const to = categoryRows.find((c) => c.id === parsed.data?.toCategoryId);
  if (parsed.success && mergeAllowed(from, to, decisions)) {
    const merged = await applyMerge(
      tx,
      { ...scope, pendingId: row.id },
      from!,
      to!,
      parsed.data.reason,
    );
    if (merged) return true;
  }
  await closePending(tx, row.id, row.dedupeKey);
  return false;
}
