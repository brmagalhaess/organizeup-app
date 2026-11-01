// Aplicar, ignorar e desfazer sugestões (regra 7 reescrita, ADR-0015). Usado pela web dentro de
// withHousehold(ctx, ...). Recarrega a sugestão, exige o status certo, revalida o payload com zod,
// executa por tipo e grava decided_*. Devolve o código do texto, que a tela mostra no idioma da pessoa.
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
import { INVESTIMENTOS_AGENT, messageColumns, recordAudit } from "./shared";
import { proventoExcluidoText } from "./texts";
import { createTrip } from "./trips";

/** O que a família lê depois de decidir. A tela usa `code`; `message` é o mesmo em português. */
export const APPLY_REPLIES = {
  readOnly: "Seu papel nesta família não permite alterações.",
  notFound: "Sugestão não encontrada.",
  decided: "Esta sugestão já foi decidida.",
  outdated: "Esta sugestão está desatualizada. Peça uma nova ao assistente.",
  debtExtra: "Combinado: o pagamento extra você registra na tela de dívidas.",
  noted: "Anotado.",
  dismissed: "Tudo bem. Voltamos a sugerir daqui a 30 dias, se ainda fizer sentido.",
  onlyApplied: "Só dá para desfazer o que foi aplicado.",
  incomplete: "Não foi possível desfazer: os dados desta sugestão estão incompletos.",
  undone: "Desfeito.",
  undoneDividends:
    "Desfeito. Esses proventos não voltam sozinhos; o preço volta com a próxima cotação nova.",
  undoneStock: "Desfeito. A quantidade voltou ao que estava, e esse ajuste não volta sozinho.",
  noPrevious: "Não há como desfazer: o estado anterior não foi guardado.",
  changedByOther: "Alguém já mudou esses lançamentos; nada foi desfeito.",
  returned: "Lançamentos devolvidos. O assistente não mexe mais neles.",
  oneCategoryGone: "Uma das categorias não existe mais.",
  merged: "Categorias juntadas. A antiga foi arquivada.",
  oldCategoryGone: "A categoria antiga foi apagada; nada foi desfeito.",
  split: "Categorias separadas de novo.",
  reserveSaved: "Valor da reserva gravado.",
  reserveRestored: "Valor da reserva devolvido ao anterior.",
  planSaved: "Quanto guardar por mês gravado no plano de aposentadoria.",
  planRestored: "Valor do plano devolvido ao anterior.",
  notAssistantTrip: "Esta viagem não foi criada pelo assistente.",
  tripRemoved: "Viagem removida.",
  tripGone: "A viagem já não existia.",
  goalGone: "Esta meta não existe mais.",
  goalNoted: "Anotado. Ajuste o valor ou a data da meta quando puder.",
  goalDate: "Data da meta ajustada. O plano é recalculado na próxima rodada.",
  goalHasValues: "A meta já recebeu valores; nada foi desfeito.",
  goalRemoved: "Meta removida.",
  goalDateChanged: "A data da meta já foi alterada; nada foi desfeito.",
  goalDateRestored: "Data da meta devolvida à anterior.",
  assistantHandles: "O assistente cuida disso sozinho: esta sugestão não precisa de aceite.",
  tripPeople: "Escolha quem vai.",
  tripPeopleInvalid: "Escolha pessoas da família.",
  tripFailed: "Não foi possível criar a viagem.",
  tripCreated: "Viagem para {name} criada. Ajuste datas e custos em Viagens.",
  goalCreated: "Meta {name} criada. Ajuste os detalhes em Metas.",
} as const;

export type ApplyCode = keyof typeof APPLY_REPLIES;

interface Said {
  code: ApplyCode;
  /** Valores do texto: só o nome criado. */
  values?: { name: string };
  message: string;
}

interface Refused {
  error: Said;
}

export interface ApplyResult {
  ok: boolean;
  message: string;
  code?: ApplyCode;
  values?: { name: string };
}

const reply = (code: ApplyCode, values?: { name: string }): Said => ({
  code,
  ...(values ? { values } : {}),
  message: values ? APPLY_REPLIES[code].replace("{name}", values.name) : APPLY_REPLIES[code],
});
const refused = (code: ApplyCode): Refused => ({ error: reply(code) });
const failed = (code: ApplyCode): ApplyResult => ({ ok: false, ...reply(code) });
/** Só o que a tela lê: `payload` fica fora do resultado. */
const said = ({ code, values, message }: Said): ApplyResult => ({
  ok: true,
  code,
  ...(values ? { values } : {}),
  message,
});

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
  if (!canWrite(ctx)) return failed("readOnly");
  const row = await lockSuggestion(tx, id);
  if (!row) return failed("notFound");
  if (row.status !== "pendente") return failed("decided");

  let payload: unknown;
  try {
    payload = parsePayload(row.kind, row.payload);
  } catch {
    return failed("outdated");
  }

  let outcome: (Said & { payload?: Record<string, unknown> }) | Refused;
  switch (row.kind) {
    case "categoria":
    case "fusao_categoria":
      outcome = refused("assistantHandles");
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
      outcome = reply("debtExtra");
      break;
    default:
      outcome = reply("noted");
  }
  if ("error" in outcome) return { ok: false, ...outcome.error };
  await decide(tx, ctx, id, "aplicada", outcome.payload);
  await recordAudit(tx, ctx, "apply", "household_suggestions", id, { kind: row.kind });
  return said(outcome);
}

/** "Agora não": a sugestão sai da fila e só volta depois de 30 dias. */
export async function dismissSuggestion(
  tx: TenantTx,
  ctx: TenantContext,
  id: string,
): Promise<ApplyResult> {
  if (!canWrite(ctx)) return failed("readOnly");
  const row = await lockSuggestion(tx, id);
  if (!row) return failed("notFound");
  if (row.status !== "pendente") return failed("decided");
  await decide(tx, ctx, id, "ignorada");
  await recordAudit(tx, ctx, "dismiss", "household_suggestions", id, { kind: row.kind });
  return {
    ok: true,
    ...reply("dismissed"),
  };
}

/** Desfaz uma sugestão aplicada (pelo assistente ou pela família) e bloqueia a repetição automática. */
export async function undoSuggestion(
  tx: TenantTx,
  ctx: TenantContext,
  id: string,
): Promise<ApplyResult> {
  if (!canWrite(ctx)) return failed("readOnly");
  const row = await lockSuggestion(tx, id);
  if (!row) return failed("notFound");
  if (row.status !== "aplicada") return failed("onlyApplied");

  let payload: unknown;
  try {
    payload = parsePayload(row.kind, row.payload);
  } catch {
    return failed("incomplete");
  }

  let outcome: Said | Refused;
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
      else outcome = market ? await undoMercado(tx, ctx, market) : reply("undone");
      break;
    }
    default:
      outcome = reply("undone");
  }
  if ("error" in outcome) return { ok: false, ...outcome.error };
  await decide(tx, ctx, id, "desfeita");
  await recordAudit(tx, ctx, "undo", "household_suggestions", id, { kind: row.kind });
  return said(outcome);
}

// ---------- cotações e proventos (ADR-0017) ----------

/**
 * Devolve o que a atualização de um dia mudou. Só toca o que continua como o sistema deixou: preço que
 * a família mudou depois, ou que uma cotação mais nova substituiu, fica. A linha `desfeita` guarda a
 * lista, e é ela que bloqueia cada alteração para sempre.
 */
async function undoMercado(tx: TenantTx, ctx: TenantContext, market: MarketChanges): Promise<Said> {
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
  return reply("undoneDividends");
}

/** Tira o ajuste da posição. As operações não foram tocadas, e a linha `desfeita` bloqueia a volta. */
async function undoStockEvent(tx: TenantTx, event: StockEventChange): Promise<Said> {
  await tx
    .delete(investmentStockEvents)
    .where(
      and(
        eq(investmentStockEvents.investmentId, event.investmentId),
        eq(investmentStockEvents.comDate, event.comDate),
        eq(investmentStockEvents.note, event.note),
      ),
    );
  return reply("undoneStock");
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
  const text = proventoExcluidoText();
  await tx.insert(householdSuggestions).values({
    householdId: ctx.householdId,
    agent: INVESTIMENTOS_AGENT,
    kind: "investimento",
    title: text.title,
    body: text.body,
    ...messageColumns(text.message),
    payload: { href: "/app/proventos", market },
    status: "desfeita",
    appliedBy: "familia",
    dedupeKey: DEDUPE.mercadoProvento(removed.investmentId, removed.marketDividendId),
    decidedAt: new Date(),
    decidedBy: ctx.userId,
  });
}

// ---------- categoria ----------

async function undoCategoria(
  tx: TenantTx,
  payload: SuggestionPayload["categoria"],
): Promise<Said | Refused> {
  const applied = payload.appliedCategoryId ?? payload.toCategoryId;
  if (!applied || !payload.previous || payload.previous.length === 0) return refused("noPrevious");
  const ids = payload.previous.map((item) => item.transactionId);
  const rows = await tx
    .select({ id: transactions.id, categoryId: transactions.categoryId })
    .from(transactions)
    .where(inArray(transactions.id, ids));
  if (rows.some((row) => row.categoryId !== applied)) return refused("changedByOther");
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
  return reply("returned");
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

/** Junta duas categorias. Quem chama é o agente de categorias, que registra e avisa a família. */
export async function applyFusao(
  tx: TenantTx,
  payload: SuggestionPayload["fusao_categoria"],
): Promise<(Said & { payload: SuggestionPayload["fusao_categoria"] }) | Refused> {
  const pair = await tx
    .select({ id: categories.id, kind: categories.kind, archived: categories.archived })
    .from(categories)
    .where(inArray(categories.id, [payload.fromCategoryId, payload.toCategoryId]));
  const from = pair.find((c) => c.id === payload.fromCategoryId);
  const to = pair.find((c) => c.id === payload.toCategoryId);
  if (!from || !to || from.kind !== to.kind) return refused("oneCategoryGone");

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
    ...reply("merged"),
    payload: { ...payload, moved },
  };
}

async function undoFusao(
  tx: TenantTx,
  payload: SuggestionPayload["fusao_categoria"],
): Promise<Said | Refused> {
  const moved = payload.moved;
  if (!moved) return refused("noPrevious");
  const [from] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, payload.fromCategoryId));
  if (!from) return refused("oldCategoryGone");
  await tx.update(categories).set({ archived: false }).where(eq(categories.id, from.id));
  if (moved.transactionIds.length > 0)
    await tx
      .update(transactions)
      .set({ categoryId: from.id, updatedAt: new Date() })
      .where(
        and(
          inArray(transactions.id, moved.transactionIds),
          eq(transactions.categoryId, payload.toCategoryId),
        ),
      );
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
  return reply("split");
}

// ---------- aportes ----------

async function applyAporteReserva(
  tx: TenantTx,
  ctx: TenantContext,
  payload: SuggestionPayload["aporte_reserva"],
): Promise<Said & { payload: Record<string, unknown> }> {
  const [fund] = await tx.select({ contribution: emergencyFund.contribution }).from(emergencyFund);
  await tx
    .insert(emergencyFund)
    .values({ householdId: ctx.householdId, contribution: payload.monthlyAmount })
    .onConflictDoUpdate({
      target: emergencyFund.householdId,
      set: { contribution: payload.monthlyAmount, updatedAt: new Date() },
    });
  return {
    ...reply("reserveSaved"),
    payload: { ...payload, previous: fund?.contribution ?? null },
  };
}

async function undoAporteReserva(
  tx: TenantTx,
  payload: SuggestionPayload["aporte_reserva"],
): Promise<Said> {
  await tx
    .update(emergencyFund)
    .set({ contribution: payload.previous, updatedAt: new Date() })
    .where(eq(emergencyFund.contribution, payload.monthlyAmount));
  return reply("reserveRestored");
}

async function applyAporteInvestimento(
  tx: TenantTx,
  ctx: TenantContext,
  payload: SuggestionPayload["aporte_investimento"],
): Promise<Said & { payload: Record<string, unknown> }> {
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
    ...reply("planSaved"),
    payload: { ...payload, previous: plan?.monthlyContribution ?? null },
  };
}

async function undoAporteInvestimento(
  tx: TenantTx,
  payload: SuggestionPayload["aporte_investimento"],
): Promise<Said> {
  await tx
    .update(retirementPlan)
    .set({ monthlyContribution: payload.previous, updatedAt: new Date() })
    .where(eq(retirementPlan.monthlyContribution, payload.monthlyAmount));
  return reply("planRestored");
}

// ---------- viagem ----------

async function applyViagem(
  tx: TenantTx,
  ctx: TenantContext,
  payload: SuggestionPayload["viagem"],
): Promise<(Said & { payload: Record<string, unknown> }) | Refused> {
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
      ...reply("tripCreated", { name: payload.name }),
      payload: { ...payload, tripId: created.tripId, eventId: created.eventId },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === APPLY_REPLIES.tripPeople) return refused("tripPeople");
    return refused(
      message === APPLY_REPLIES.tripPeopleInvalid ? "tripPeopleInvalid" : "tripFailed",
    );
  }
}

async function undoViagem(
  tx: TenantTx,
  payload: SuggestionPayload["viagem"],
): Promise<Said | Refused> {
  if (!payload.tripId) return refused("notAssistantTrip");
  const [removed] = await tx
    .delete(trips)
    .where(eq(trips.id, payload.tripId))
    .returning({ calendarEventId: trips.calendarEventId });
  if (removed?.calendarEventId) {
    await tx.delete(calendarEvents).where(eq(calendarEvents.id, removed.calendarEventId));
  }
  return reply(removed ? "tripRemoved" : "tripGone");
}

// ---------- meta ----------

async function applyMeta(
  tx: TenantTx,
  ctx: TenantContext,
  payload: SuggestionPayload["meta"],
): Promise<(Said & { payload: Record<string, unknown> }) | Refused> {
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
      ...reply("goalCreated", { name: payload.draft.name }),
      payload: { ...payload, goalId: created!.id },
    };
  }
  const [goal] = await tx
    .select({ id: goals.id, desiredMonth: goals.desiredMonth })
    .from(goals)
    .where(eq(goals.id, payload.goalId));
  if (!goal) return refused("goalGone");
  if (payload.proposedMonth === null)
    return {
      ...reply("goalNoted"),
      payload: { ...payload },
    };
  await tx
    .update(goals)
    .set({ desiredMonth: payload.proposedMonth, updatedAt: new Date() })
    .where(eq(goals.id, goal.id));
  return {
    ...reply("goalDate"),
    payload: { ...payload, previousDesiredMonth: goal.desiredMonth },
  };
}

async function undoMeta(tx: TenantTx, payload: SuggestionPayload["meta"]): Promise<Said | Refused> {
  if (payload.draft) {
    const removed = await tx
      .delete(goals)
      .where(and(eq(goals.id, payload.goalId), eq(goals.saved, "0")))
      .returning({ id: goals.id });
    if (removed.length === 0) return refused("goalHasValues");
    return reply("goalRemoved");
  }
  if (payload.previousDesiredMonth === undefined || payload.proposedMonth === null)
    return reply("undone");
  const updated = await tx
    .update(goals)
    .set({ desiredMonth: payload.previousDesiredMonth, updatedAt: new Date() })
    .where(and(eq(goals.id, payload.goalId), eq(goals.desiredMonth, payload.proposedMonth)))
    .returning({ id: goals.id });
  if (updated.length === 0) return refused("goalDateChanged");
  return reply("goalDateRestored");
}
