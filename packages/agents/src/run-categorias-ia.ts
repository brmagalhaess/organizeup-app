// Parte de banco da categorização com IA (ADR-0018). O modelo é chamado por `packages/ai`, fora de
// qualquer transação; aqui se escolhe o que vai para ele e se aplica o plano já validado pelo domínio.
// Regra 7: o que está em categoria genérica muda sem aceite, e o que foi desfeito não volta.
import {
  and,
  categories,
  eq,
  householdReports,
  inArray,
  or,
  transactions,
  type TenantTx,
} from "@organizeup/db";
import {
  categoryCandidates,
  categoryDedupeKey,
  dailyCategoryReport,
  isCategoryCandidate,
  isGenericCategory,
  memoryKey,
  merchantsOfDedupeKeys,
  withAiSummary,
  type CategoryCandidate,
  type CategoryMove,
  type CategoryOption,
  type CategoryPlan,
  type ReportCategoriasIa,
  type ReviewGroup,
} from "@organizeup/domain";
import { applyGroup, CATEGORIAS_AGENT } from "./run-categorias";
import { AI_CATEGORY_REASON, DEDUPE, type CategoriaPayload } from "./suggestions";
import {
  clamp,
  loadDecisions,
  MAX_REPORT_SUMMARY,
  recordSkipped,
  saveDailyReport,
  type PendingSuggestion,
} from "./shared";

export const CATEGORIAS_IA_AGENT = "categorias_ia";

/** Estabelecimentos por noite: pelo tamanho do histórico, limpa em poucos dias. */
export const MAX_AI_GROUPS = 80;
/** Categorias novas por noite. O resto volta amanhã, já vendo as que nasceram hoje. */
export const MAX_AI_NEW_CATEGORIES = 5;

export interface CategoryReviewInput {
  groups: CategoryCandidate[];
  /** Categorias ativas. Filtre as de sistema antes de mostrar ao modelo. */
  categories: CategoryOption[];
}

/** O que a noite de hoje pode mandar ao modelo, dos maiores valores para os menores. */
export async function loadCategoryCandidates(
  tx: TenantTx,
  today: string,
): Promise<CategoryReviewInput> {
  const categoryRows = await tx.select().from(categories);
  const nameOf = new Map(categoryRows.map((c) => [c.id, c.name]));
  const generic = categoryRows.filter((c) => isGenericCategory(c.name)).map((c) => c.id);
  const rows = await tx
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
    .where(
      or(
        generic.length > 0 ? inArray(transactions.categoryId, generic) : undefined,
        eq(transactions.categorySource, "revisar"),
      ),
    );

  const decisions = await loadDecisions(tx, today);
  const closed = merchantsOfDedupeKeys([...decisions.blocked, ...decisions.recentlyIgnored]);
  return {
    groups: categoryCandidates(
      rows.map((row) => ({ ...row, categoryName: nameOf.get(row.categoryId) ?? "" })),
      closed,
      MAX_AI_GROUPS,
    ),
    categories: categoryRows
      .filter((c) => !c.archived)
      .map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
  };
}

export interface CategoryApplyInput {
  today: string;
  householdId: string;
  plan: CategoryPlan;
  /** Quantos grupos foram ao modelo. */
  sent: number;
}

export interface CategoryApplyResult {
  /** Lançamentos movidos. */
  moved: number;
  created: string[];
  /** Grupos sem resposta aproveitável ou com pouca confiança, fora por 30 dias. */
  skipped: number;
}

const moveGroup = (move: CategoryMove, rows: Array<{ id: string }>): ReviewGroup => {
  const { kind, merchant, fromCategoryId } = move.group;
  return {
    ids: rows.map((row) => row.id),
    kind,
    merchant,
    fromCategoryId,
    toCategoryId: move.target.categoryId,
    newCategory: move.target.newCategory,
    reason: AI_CATEGORY_REASON,
    dedupeKey: categoryDedupeKey(kind, merchant.slice(0, 120), move.target),
  };
};

function skippedItem(group: CategoryCandidate): PendingSuggestion {
  const payload: CategoriaPayload = {
    kind: group.kind,
    transactionIds: group.ids,
    fromCategoryId: group.fromCategoryId,
    toCategoryId: null,
    newCategory: null,
    merchant: group.merchant.slice(0, 120),
  };
  return {
    kind: "categoria",
    title: "Sem categoria clara",
    body: "O assistente não soube classificar este estabelecimento e tenta de novo em 30 dias.",
    payload,
    dedupeKey: DEDUPE.categoriaSemPista(group.kind, group.merchant.slice(0, 120)),
  };
}

/** Aplica o plano numa transação só, relendo os lançamentos: a família pode ter mudado algo. */
export async function applyCategoryPlan(
  tx: TenantTx,
  input: CategoryApplyInput,
): Promise<CategoryApplyResult> {
  const { today, householdId, plan, sent } = input;
  const decisions = await loadDecisions(tx, today);
  const blocked = merchantsOfDedupeKeys(decisions.blocked);
  const categoryRows = await tx.select().from(categories);
  const nameOf = new Map(categoryRows.map((c) => [c.id, c.name]));
  const ids = plan.moves.flatMap((move) => move.group.ids);
  const rows =
    ids.length === 0
      ? []
      : await tx
          .select({
            id: transactions.id,
            categoryId: transactions.categoryId,
            amount: transactions.amount,
            categorySource: transactions.categorySource,
            importBatchId: transactions.importBatchId,
          })
          .from(transactions)
          .where(inArray(transactions.id, ids));
  const current = new Map(
    rows.map((row) => [row.id, { ...row, categoryName: nameOf.get(row.categoryId) ?? "" }]),
  );

  const created: string[] = [];
  const doubtful: CategoryCandidate[] = [];
  let moved = 0;
  for (const move of plan.moves) {
    const { group } = move;
    if (blocked.has(memoryKey(group.kind, group.merchant))) continue;
    const still = group.ids.flatMap((id) => {
      const row = current.get(id);
      return row && isCategoryCandidate(row) ? [row] : [];
    });
    if (still.length === 0) continue;

    // Pouca confiança não muda nem pergunta: volta a ser avaliada depois do intervalo.
    if (move.confidence === "baixa") {
      doubtful.push(group);
      continue;
    }
    const target = await applyGroup(
      tx,
      { householdId, today },
      moveGroup(move, still),
      current,
      nameOf,
      created,
    );
    if (target && move.target.newCategory) nameOf.set(target, move.target.newCategory.name);
    if (target) moved += still.length;
  }

  const skipped = [...plan.unknown, ...plan.rejected, ...doubtful];
  for (const group of skipped) {
    await recordSkipped(tx, householdId, CATEGORIAS_AGENT, skippedItem(group));
  }

  const ia: ReportCategoriasIa = { groups: sent, moved, created, skipped: skipped.length };
  await addToDailyReport(tx, householdId, today, ia);
  return { moved, created, skipped: skipped.length };
}

/** Soma ao relatório do dia. Se o agente de regras falhou, nasce um relatório só com a IA. */
async function addToDailyReport(
  tx: TenantTx,
  householdId: string,
  today: string,
  ia: ReportCategoriasIa,
): Promise<void> {
  const [row] = await tx
    .select({
      id: householdReports.id,
      summary: householdReports.summary,
      data: householdReports.data,
    })
    .from(householdReports)
    .where(and(eq(householdReports.kind, "categorias"), eq(householdReports.period, today)));
  if (!row) {
    const report = dailyCategoryReport({
      reviewed: 0,
      moved: 0,
      merges: 0,
      created: [],
      day: today,
      ia,
    });
    await saveDailyReport(tx, householdId, CATEGORIAS_AGENT, "categorias", today, report);
    return;
  }
  await tx
    .update(householdReports)
    .set({
      summary: clamp(withAiSummary(row.summary, ia), MAX_REPORT_SUMMARY),
      data: { ...(row.data as Record<string, unknown>), ia },
    })
    .where(eq(householdReports.id, row.id));
}
