// Aplicar, ignorar e desfazer sugestões (regra 7 reescrita, ADR-0015). Usado pela web dentro de
// withHousehold(ctx, ...). Recarrega a sugestão, exige o status certo, revalida o payload com zod,
// executa por tipo e grava decided_*. Devolve uma mensagem em português para a tela.
import {
  and,
  calendarEvents,
  canWrite,
  cardPurchases,
  cashflowPlans,
  categories,
  categoryMemory,
  dividends,
  emergencyFund,
  ensureCategory,
  eq,
  goals,
  householdSuggestions,
  inArray,
  incomeSources,
  investments,
  investmentStockEvents,
  retirementPlan,
  trips,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import { transactions } from "@organizeup/db";
import { daysInMonth } from "@organizeup/domain";
import {
  DEDUPE,
  parsePayload,
  type MarketChanges,
  type StockEventChange,
  type SuggestionPayload,
} from "./suggestions";
import { INVESTIMENTOS_AGENT, recordAudit } from "./shared";
import { createTrip } from "./trips";

export interface ApplyResult {
  ok: boolean;
  message: string;
}

const READ_ONLY = "Seu papel nesta família não permite alterações.";
const NOT_FOUND = "Sugestão não encontrada.";

type SuggestionRow = typeof householdSuggestions.$inferSelect;

async function lockSuggestion(tx: TenantTx, id: string): Promise<SuggestionRow | null> {
  const [row] = await tx
    .select()
    .from(householdSuggestions)
    .where(eq(householdSuggestions.id, id))
    .for("update");
  return row ?? null;
}

async function decide(
  tx: TenantTx,
  ctx: TenantContext,
  id: string,
  status: "aplicada" | "ignorada" | "desfeita",
  payload?: Record<string, unknown>,
): Promise<void> {
  await tx
    .update(householdSuggestions)
    .set({
      status,
      appliedBy: "familia",
      decidedAt: new Date(),
      decidedBy: ctx.userId,
      ...(payload ? { payload } : {}),
    })
    .where(eq(householdSuggestions.id, id));
}

/** Aceita uma sugestão pendente e executa o que ela propõe. */
export async function applySuggestion(
  tx: TenantTx,
  ctx: TenantContext,
  id: string,
): Promise<ApplyResult> {
  if (!canWrite(ctx)) return { ok: false, message: READ_ONLY };
  const row = await lockSuggestion(tx, id);
  if (!row) return { ok: false, message: NOT_FOUND };
  if (row.status !== "pendente") return { ok: false, message: "Esta sugestão já foi decidida." };

  let payload: unknown;
  try {
    payload = parsePayload(row.kind, row.payload);
  } catch {
    return { ok: false, message: "Esta sugestão está desatualizada. Peça uma nova ao assistente." };
  }

  let outcome: { message: string; payload?: Record<string, unknown> } | { error: string };
  switch (row.kind) {
    case "categoria":
      outcome = await applyCategoria(tx, ctx, payload as SuggestionPayload["categoria"]);
      break;
    case "fusao_categoria":
      outcome = await applyFusao(tx, payload as SuggestionPayload["fusao_categoria"]);
      break;
    case "aporte_reserva":
      outcome = await applyAporteReserva(tx, ctx, payload as SuggestionPayload["aporte_reserva"]);
      break;
    case "aporte_investimento":
      outcome = await applyAporteInvestimento(
        tx,
        ctx,
        payload as SuggestionPayload["aporte_investimento"],
      );
      break;
    case "viagem":
      outcome = await applyViagem(tx, ctx, payload as SuggestionPayload["viagem"]);
      break;
    case "meta":
      outcome = await applyMeta(tx, ctx, payload as SuggestionPayload["meta"]);
      break;
    case "aporte_divida":
      outcome = { message: "Combinado: o pagamento extra você registra na tela de dívidas." };
      break;
    default:
      outcome = { message: "Anotado." };
  }
  if ("error" in outcome) return { ok: false, message: outcome.error };
  await decide(tx, ctx, id, "aplicada", outcome.payload);
  await recordAudit(tx, ctx, "apply", "household_suggestions", id, { kind: row.kind });
  return { ok: true, message: outcome.message };
}

/** "Agora não": a sugestão sai da fila e só volta depois de 30 dias. */
export async function dismissSuggestion(
  tx: TenantTx,
  ctx: TenantContext,
  id: string,
): Promise<ApplyResult> {
  if (!canWrite(ctx)) return { ok: false, message: READ_ONLY };
  const row = await lockSuggestion(tx, id);
  if (!row) return { ok: false, message: NOT_FOUND };
  if (row.status !== "pendente") return { ok: false, message: "Esta sugestão já foi decidida." };
  await decide(tx, ctx, id, "ignorada");
  await recordAudit(tx, ctx, "dismiss", "household_suggestions", id, { kind: row.kind });
  return {
    ok: true,
    message: "Tudo bem. Voltamos a sugerir daqui a 30 dias, se ainda fizer sentido.",
  };
}

/** Desfaz uma sugestão aplicada (pelo assistente ou pela família) e bloqueia a repetição automática. */
export async function undoSuggestion(
  tx: TenantTx,
  ctx: TenantContext,
  id: string,
): Promise<ApplyResult> {
  if (!canWrite(ctx)) return { ok: false, message: READ_ONLY };
  const row = await lockSuggestion(tx, id);
  if (!row) return { ok: false, message: NOT_FOUND };
  if (row.status !== "aplicada")
    return { ok: false, message: "Só dá para desfazer o que foi aplicado." };

  let payload: unknown;
  try {
    payload = parsePayload(row.kind, row.payload);
  } catch {
    return {
      ok: false,
      message: "Não foi possível desfazer: os dados desta sugestão estão incompletos.",
    };
  }

  let outcome: { message: string } | { error: string };
  switch (row.kind) {
    case "categoria":
      outcome = await undoCategoria(tx, payload as SuggestionPayload["categoria"]);
      break;
    case "fusao_categoria":
      outcome = await undoFusao(tx, payload as SuggestionPayload["fusao_categoria"]);
      break;
    case "aporte_reserva":
      outcome = await undoAporteReserva(tx, payload as SuggestionPayload["aporte_reserva"]);
      break;
    case "aporte_investimento":
      outcome = await undoAporteInvestimento(
        tx,
        payload as SuggestionPayload["aporte_investimento"],
      );
      break;
    case "viagem":
      outcome = await undoViagem(tx, payload as SuggestionPayload["viagem"]);
      break;
    case "meta":
      outcome = await undoMeta(tx, payload as SuggestionPayload["meta"]);
      break;
    case "investimento": {
      const { market, stockEvent } = payload as SuggestionPayload["investimento"];
      if (stockEvent) outcome = await undoStockEvent(tx, stockEvent);
      else outcome = market ? await undoMercado(tx, ctx, market) : { message: "Desfeito." };
      break;
    }
    default:
      outcome = { message: "Desfeito." };
  }
  if ("error" in outcome) return { ok: false, message: outcome.error };
  await decide(tx, ctx, id, "desfeita");
  await recordAudit(tx, ctx, "undo", "household_suggestions", id, { kind: row.kind });
  return { ok: true, message: outcome.message };
}

// ---------- cotações e proventos (ADR-0017) ----------

/**
 * Devolve o que a atualização de um dia mudou. Só toca o que continua como o sistema deixou: preço que
 * a família mudou depois, ou que uma cotação mais nova substituiu, fica. A linha `desfeita` guarda a
 * lista, e é ela que bloqueia cada alteração para sempre.
 */
async function undoMercado(
  tx: TenantTx,
  ctx: TenantContext,
  market: MarketChanges,
): Promise<{ message: string }> {
  for (const change of market.prices) {
    await tx
      .update(investments)
      .set({
        currentPrice: change.previous.price,
        valuedOn: change.previous.valuedOn,
        priceSource: change.previous.source,
      })
      .where(
        and(
          eq(investments.id, change.investmentId),
          eq(investments.priceSource, "mercado"),
          eq(investments.valuedOn, change.quoteDate),
        ),
      );
  }
  const created = market.created.map((item) => item.dividendId);
  if (created.length > 0) {
    await tx
      .delete(dividends)
      .where(and(inArray(dividends.id, created), eq(dividends.source, "agente")));
  }
  for (const item of market.adjusted) {
    await tx
      .update(dividends)
      .set(item.previous)
      .where(
        and(
          eq(dividends.id, item.dividendId),
          eq(dividends.source, "agente"),
          eq(dividends.gross, item.gross),
        ),
      );
  }
  for (const { investmentId, marketDividendId, ...row } of market.removed) {
    await tx
      .insert(dividends)
      .values({
        householdId: ctx.householdId,
        investmentId,
        marketDividendId,
        source: "agente",
        ...row,
      })
      .onConflictDoNothing();
  }
  return {
    message:
      "Desfeito. Esses proventos não voltam sozinhos; o preço volta com a próxima cotação nova.",
  };
}

/** Tira o ajuste da posição. As operações não foram tocadas, e a linha `desfeita` bloqueia a volta. */
async function undoStockEvent(tx: TenantTx, event: StockEventChange): Promise<{ message: string }> {
  await tx
    .delete(investmentStockEvents)
    .where(
      and(
        eq(investmentStockEvents.investmentId, event.investmentId),
        eq(investmentStockEvents.comDate, event.comDate),
        eq(investmentStockEvents.note, event.note),
      ),
    );
  return {
    message: "Desfeito. A quantidade voltou ao que estava, e esse ajuste não volta sozinho.",
  };
}

/**
 * A família excluiu um provento automático. Fica a marca `desfeita`, que o agente lê para não recriá-lo.
 * Rode na mesma transação da exclusão.
 */
export async function recordDividendRemoval(
  tx: TenantTx,
  ctx: TenantContext,
  removed: { dividendId: string; investmentId: string; marketDividendId: string },
): Promise<void> {
  const market: MarketChanges = { prices: [], created: [removed], adjusted: [], removed: [] };
  await tx.insert(householdSuggestions).values({
    householdId: ctx.householdId,
    agent: INVESTIMENTOS_AGENT,
    kind: "investimento",
    title: "Provento automático excluído",
    body: "Você excluiu este provento, e ele não volta sozinho.",
    payload: { href: "/app/proventos", market },
    status: "desfeita",
    appliedBy: "familia",
    dedupeKey: DEDUPE.mercadoProvento(removed.investmentId, removed.marketDividendId),
    decidedAt: new Date(),
    decidedBy: ctx.userId,
  });
}

// ---------- categoria ----------

async function applyCategoria(
  tx: TenantTx,
  ctx: TenantContext,
  payload: SuggestionPayload["categoria"],
): Promise<{ message: string; payload: Record<string, unknown> } | { error: string }> {
  let target = payload.toCategoryId;
  let createdCategoryId = payload.createdCategoryId;
  if (target === null) {
    if (!payload.newCategory) return { error: "Sugestão sem categoria de destino." };
    const result = await ensureCategory(
      tx,
      ctx.householdId,
      payload.kind,
      payload.newCategory.name,
      payload.newCategory.essential,
    );
    target = result.id;
    if (result.created) {
      createdCategoryId = target;
      await recordAudit(tx, ctx, "create", "categories", target);
    }
  } else {
    const [category] = await tx
      .select({ id: categories.id, kind: categories.kind })
      .from(categories)
      .where(eq(categories.id, target));
    if (!category || category.kind !== payload.kind)
      return { error: "A categoria sugerida não existe mais." };
  }
  const rows = await tx
    .select({
      id: transactions.id,
      categoryId: transactions.categoryId,
      categorySource: transactions.categorySource,
    })
    .from(transactions)
    .where(inArray(transactions.id, payload.transactionIds));
  if (rows.length === 0) return { error: "Esses lançamentos não existem mais." };
  const previous = rows.map((row) => ({
    transactionId: row.id,
    categoryId: row.categoryId,
    categorySource: row.categorySource,
  }));
  await tx
    .update(transactions)
    .set({ categoryId: target, categorySource: "familia", updatedAt: new Date() })
    .where(
      inArray(
        transactions.id,
        rows.map((row) => row.id),
      ),
    );
  if (payload.merchant) {
    await tx
      .insert(categoryMemory)
      .values({
        householdId: ctx.householdId,
        kind: payload.kind,
        merchant: payload.merchant.slice(0, 120),
        categoryId: target,
        source: "familia",
      })
      .onConflictDoUpdate({
        target: [categoryMemory.householdId, categoryMemory.kind, categoryMemory.merchant],
        set: { categoryId: target, source: "familia", updatedAt: new Date() },
      });
  }
  return {
    message: `${rows.length === 1 ? "Lançamento movido" : `${rows.length} lançamentos movidos`}.`,
    payload: {
      ...payload,
      toCategoryId: target,
      previous,
      appliedCategoryId: target,
      ...(createdCategoryId ? { createdCategoryId } : {}),
    },
  };
}

async function undoCategoria(
  tx: TenantTx,
  payload: SuggestionPayload["categoria"],
): Promise<{ message: string } | { error: string }> {
  const applied = payload.appliedCategoryId ?? payload.toCategoryId;
  if (!applied || !payload.previous || payload.previous.length === 0)
    return { error: "Não há como desfazer: o estado anterior não foi guardado." };
  const ids = payload.previous.map((item) => item.transactionId);
  const rows = await tx
    .select({ id: transactions.id, categoryId: transactions.categoryId })
    .from(transactions)
    .where(inArray(transactions.id, ids));
  if (rows.some((row) => row.categoryId !== applied))
    return { error: "Alguém já mudou esses lançamentos; nada foi desfeito." };
  for (const item of payload.previous) {
    await tx
      .update(transactions)
      .set({
        categoryId: item.categoryId,
        categorySource: "familia",
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, item.transactionId));
  }
  if (payload.merchant) {
    await tx
      .delete(categoryMemory)
      .where(
        and(
          eq(categoryMemory.kind, payload.kind),
          eq(categoryMemory.merchant, payload.merchant.slice(0, 120)),
          eq(categoryMemory.source, "agente"),
        ),
      );
  }
  if (payload.createdCategoryId) await archiveIfUnused(tx, payload.createdCategoryId);
  return { message: "Lançamentos devolvidos. O assistente não mexe mais neles." };
}

/**
 * A categoria nasceu com a mudança desfeita. Sem outro uso, sai das listas; com outro lançamento,
 * previsão, compra ou renda, fica. Arquiva em vez de apagar: outra sugestão pode citar o id.
 */
async function archiveIfUnused(tx: TenantTx, categoryId: string): Promise<void> {
  const uses = await Promise.all(
    [transactions, cashflowPlans, cardPurchases, incomeSources].map((table) =>
      tx.select({ id: table.id }).from(table).where(eq(table.categoryId, categoryId)).limit(1),
    ),
  );
  if (uses.some((rows) => rows.length > 0)) return;
  await tx
    .delete(categoryMemory)
    .where(and(eq(categoryMemory.categoryId, categoryId), eq(categoryMemory.source, "agente")));
  await tx.update(categories).set({ archived: true }).where(eq(categories.id, categoryId));
}

// ---------- fusão de categorias ----------

async function applyFusao(
  tx: TenantTx,
  payload: SuggestionPayload["fusao_categoria"],
): Promise<{ message: string; payload: Record<string, unknown> } | { error: string }> {
  const pair = await tx
    .select({ id: categories.id, kind: categories.kind, archived: categories.archived })
    .from(categories)
    .where(inArray(categories.id, [payload.fromCategoryId, payload.toCategoryId]));
  const from = pair.find((c) => c.id === payload.fromCategoryId);
  const to = pair.find((c) => c.id === payload.toCategoryId);
  if (!from || !to || from.kind !== to.kind)
    return { error: "Uma das categorias não existe mais." };

  const movedTx = await tx
    .update(transactions)
    .set({ categoryId: to.id, updatedAt: new Date() })
    .where(eq(transactions.categoryId, from.id))
    .returning({ id: transactions.id });
  const movedPlans = await tx
    .update(cashflowPlans)
    .set({ categoryId: to.id })
    .where(eq(cashflowPlans.categoryId, from.id))
    .returning({ id: cashflowPlans.id });
  const movedPurchases = await tx
    .update(cardPurchases)
    .set({ categoryId: to.id })
    .where(eq(cardPurchases.categoryId, from.id))
    .returning({ id: cardPurchases.id });
  const movedIncome = await tx
    .update(incomeSources)
    .set({ categoryId: to.id })
    .where(eq(incomeSources.categoryId, from.id))
    .returning({ id: incomeSources.id });
  const movedMemory = await tx
    .update(categoryMemory)
    .set({ categoryId: to.id, updatedAt: new Date() })
    .where(eq(categoryMemory.categoryId, from.id))
    .returning({ kind: categoryMemory.kind, merchant: categoryMemory.merchant });
  await tx.update(categories).set({ archived: true }).where(eq(categories.id, from.id));
  const moved = {
    transactionIds: movedTx.map((r) => r.id),
    planIds: movedPlans.map((r) => r.id),
    purchaseIds: movedPurchases.map((r) => r.id),
    incomeSourceIds: movedIncome.map((r) => r.id),
    memoryMerchants: movedMemory,
  };
  return {
    message: "Categorias juntadas. A antiga foi arquivada.",
    payload: { ...payload, moved },
  };
}

async function undoFusao(
  tx: TenantTx,
  payload: SuggestionPayload["fusao_categoria"],
): Promise<{ message: string } | { error: string }> {
  const moved = payload.moved;
  if (!moved) return { error: "Não há como desfazer: o estado anterior não foi guardado." };
  const [from] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, payload.fromCategoryId));
  if (!from) return { error: "A categoria antiga foi apagada; nada foi desfeito." };
  await tx.update(categories).set({ archived: false }).where(eq(categories.id, from.id));
  if (moved.transactionIds.length > 0)
    await tx
      .update(transactions)
      .set({ categoryId: from.id, updatedAt: new Date() })
      .where(inArray(transactions.id, moved.transactionIds));
  if (moved.planIds.length > 0)
    await tx
      .update(cashflowPlans)
      .set({ categoryId: from.id })
      .where(inArray(cashflowPlans.id, moved.planIds));
  if (moved.purchaseIds.length > 0)
    await tx
      .update(cardPurchases)
      .set({ categoryId: from.id })
      .where(inArray(cardPurchases.id, moved.purchaseIds));
  if (moved.incomeSourceIds.length > 0)
    await tx
      .update(incomeSources)
      .set({ categoryId: from.id })
      .where(inArray(incomeSources.id, moved.incomeSourceIds));
  for (const item of moved.memoryMerchants) {
    await tx
      .update(categoryMemory)
      .set({ categoryId: from.id, updatedAt: new Date() })
      .where(and(eq(categoryMemory.kind, item.kind), eq(categoryMemory.merchant, item.merchant)));
  }
  return { message: "Categorias separadas de novo." };
}

// ---------- aportes ----------

async function applyAporteReserva(
  tx: TenantTx,
  ctx: TenantContext,
  payload: SuggestionPayload["aporte_reserva"],
): Promise<{ message: string; payload: Record<string, unknown> }> {
  const [fund] = await tx.select({ contribution: emergencyFund.contribution }).from(emergencyFund);
  await tx
    .insert(emergencyFund)
    .values({ householdId: ctx.householdId, contribution: payload.monthlyAmount })
    .onConflictDoUpdate({
      target: emergencyFund.householdId,
      set: { contribution: payload.monthlyAmount, updatedAt: new Date() },
    });
  return {
    message: "Valor da reserva gravado.",
    payload: { ...payload, previous: fund?.contribution ?? null },
  };
}

async function undoAporteReserva(
  tx: TenantTx,
  payload: SuggestionPayload["aporte_reserva"],
): Promise<{ message: string }> {
  await tx
    .update(emergencyFund)
    .set({ contribution: payload.previous, updatedAt: new Date() })
    .where(eq(emergencyFund.contribution, payload.monthlyAmount));
  return { message: "Valor da reserva devolvido ao anterior." };
}

async function applyAporteInvestimento(
  tx: TenantTx,
  ctx: TenantContext,
  payload: SuggestionPayload["aporte_investimento"],
): Promise<{ message: string; payload: Record<string, unknown> }> {
  const [plan] = await tx
    .select({ monthlyContribution: retirementPlan.monthlyContribution })
    .from(retirementPlan);
  await tx
    .insert(retirementPlan)
    .values({ householdId: ctx.householdId, monthlyContribution: payload.monthlyAmount })
    .onConflictDoUpdate({
      target: retirementPlan.householdId,
      set: { monthlyContribution: payload.monthlyAmount, updatedAt: new Date() },
    });
  return {
    message: "Quanto guardar por mês gravado no plano de aposentadoria.",
    payload: { ...payload, previous: plan?.monthlyContribution ?? null },
  };
}

async function undoAporteInvestimento(
  tx: TenantTx,
  payload: SuggestionPayload["aporte_investimento"],
): Promise<{ message: string }> {
  await tx
    .update(retirementPlan)
    .set({ monthlyContribution: payload.previous, updatedAt: new Date() })
    .where(eq(retirementPlan.monthlyContribution, payload.monthlyAmount));
  return { message: "Valor do plano devolvido ao anterior." };
}

// ---------- viagem ----------

async function applyViagem(
  tx: TenantTx,
  ctx: TenantContext,
  payload: SuggestionPayload["viagem"],
): Promise<{ message: string; payload: Record<string, unknown> } | { error: string }> {
  const startOn = `${payload.month}-01`;
  const lastDay = Math.min(payload.days, daysInMonth(payload.month));
  const endOn = `${payload.month}-${String(lastDay).padStart(2, "0")}`;
  try {
    const created = await createTrip(tx, ctx, {
      destination: payload.name,
      startOn,
      endOn: endOn > startOn ? endOn : null,
      personIds: payload.personIds,
      costs: (["passagem", "hospedagem", "alimentacao", "transporte"] as const).map((kind) => ({
        kind,
        amount: payload.estimated[kind],
        perPerson: false,
      })),
    });
    return {
      message: `Viagem para ${payload.name} criada. Ajuste datas e custos em Viagens.`,
      payload: { ...payload, tripId: created.tripId, eventId: created.eventId },
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Não foi possível criar a viagem." };
  }
}

async function undoViagem(
  tx: TenantTx,
  payload: SuggestionPayload["viagem"],
): Promise<{ message: string } | { error: string }> {
  if (!payload.tripId) return { error: "Esta viagem não foi criada pelo assistente." };
  const [removed] = await tx
    .delete(trips)
    .where(eq(trips.id, payload.tripId))
    .returning({ calendarEventId: trips.calendarEventId });
  if (removed?.calendarEventId) {
    await tx.delete(calendarEvents).where(eq(calendarEvents.id, removed.calendarEventId));
  }
  return { message: removed ? "Viagem removida." : "A viagem já não existia." };
}

// ---------- meta ----------

async function applyMeta(
  tx: TenantTx,
  ctx: TenantContext,
  payload: SuggestionPayload["meta"],
): Promise<{ message: string; payload: Record<string, unknown> } | { error: string }> {
  if (payload.draft) {
    const [created] = await tx
      .insert(goals)
      .values({
        householdId: ctx.householdId,
        name: payload.draft.name,
        kind: "outro",
        targetAmount: payload.draft.targetAmount,
        desiredMonth: payload.draft.desiredMonth,
        createdBy: ctx.userId,
      })
      .returning({ id: goals.id });
    await recordAudit(tx, ctx, "create", "goals", created!.id);
    return {
      message: `Meta ${payload.draft.name} criada. Ajuste os detalhes em Metas.`,
      payload: { ...payload, goalId: created!.id },
    };
  }
  const [goal] = await tx
    .select({ id: goals.id, desiredMonth: goals.desiredMonth })
    .from(goals)
    .where(eq(goals.id, payload.goalId));
  if (!goal) return { error: "Esta meta não existe mais." };
  if (payload.proposedMonth === null)
    return {
      message: "Anotado. Ajuste o valor ou a data da meta quando puder.",
      payload: { ...payload },
    };
  await tx
    .update(goals)
    .set({ desiredMonth: payload.proposedMonth, updatedAt: new Date() })
    .where(eq(goals.id, goal.id));
  return {
    message: "Data da meta ajustada. O plano é recalculado na próxima rodada.",
    payload: { ...payload, previousDesiredMonth: goal.desiredMonth },
  };
}

async function undoMeta(
  tx: TenantTx,
  payload: SuggestionPayload["meta"],
): Promise<{ message: string } | { error: string }> {
  if (payload.draft) {
    const removed = await tx
      .delete(goals)
      .where(and(eq(goals.id, payload.goalId), eq(goals.saved, "0")))
      .returning({ id: goals.id });
    if (removed.length === 0) return { error: "A meta já recebeu valores; nada foi desfeito." };
    return { message: "Meta removida." };
  }
  if (payload.previousDesiredMonth === undefined || payload.proposedMonth === null)
    return { message: "Desfeito." };
  const updated = await tx
    .update(goals)
    .set({ desiredMonth: payload.previousDesiredMonth, updatedAt: new Date() })
    .where(and(eq(goals.id, payload.goalId), eq(goals.desiredMonth, payload.proposedMonth)))
    .returning({ id: goals.id });
  if (updated.length === 0) return { error: "A data da meta já foi alterada; nada foi desfeito." };
  return { message: "Data da meta devolvida à anterior." };
}
