// Peças comuns aos agentes: contrato de entrada/saída, auditoria, gravação de sugestões e do
// relatório do dia. Tudo roda dentro do `tx` recebido; nada de I/O fora dele.
import {
  and,
  auditLog,
  desc,
  eq,
  gte,
  householdReports,
  householdSuggestions,
  inArray,
  sql,
  type SuggestionKind,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import type { Allocation } from "@organizeup/domain";
import type { DailyReport, DailyReportKind } from "./reports";

export interface AgentInput {
  /** Data civil de hoje no fuso da família (AAAA-MM-DD). */
  today: string;
  householdId: string;
  /** Divisão do que sobra, calculada pelo agente de aposentadoria na mesma rodada. */
  allocation?: Allocation;
}

export interface AgentResult {
  /** Sugestões pendentes gravadas (ou atualizadas) nesta rodada. */
  suggestions: number;
  /** Alterações automáticas aplicadas pelo agente nesta rodada. */
  applied: number;
  report: { title: string; summary: string; data: Record<string, unknown> };
}

export const INVESTIMENTOS_AGENT = "investimentos";

/** Dias em que uma sugestão ignorada pela família não volta. */
export const IGNORED_DAYS = 30;
/** Dias de lançamentos revisados pelo agente de categorias. */
export const REVIEW_DAYS = 90;
/** Preço de investimento mais velho que isto pede atualização. */
export const STALE_PRICE_DAYS = 30;

export const MAX_TITLE = 120;
export const MAX_BODY = 800;
export const MAX_REPORT_TITLE = 200;
export const MAX_REPORT_SUMMARY = 2000;

/** Corta no limite da coluna sem quebrar a frase com reticências estranhas no meio de um número. */
export function clamp(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed || "-";
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Data civil deslocada em dias (AAAA-MM-DD). */
export function shiftDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Dias corridos entre duas datas civis (`to` − `from`). */
export function daysBetween(from: string, to: string): number {
  const at = (date: string) => {
    const [year, month, day] = date.split("-").map(Number) as [number, number, number];
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/**
 * Auditoria com o ator certo: `system` quando o contexto é do worker, `user` quando é da família.
 * Mesma forma de apps/web/src/lib/audit.ts, sem importar da web.
 */
export async function recordAudit(
  tx: TenantTx,
  ctx: Pick<TenantContext, "householdId" | "userId" | "role">,
  action: string,
  entity: string,
  entityId?: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(auditLog).values({
    householdId: ctx.householdId,
    actorUserId: ctx.userId,
    actorKind: ctx.role === "system" ? "system" : "user",
    action,
    entity,
    entityId: entityId ?? null,
    metadata,
  });
}

/** Contexto mínimo do worker para auditoria (papel `system`, sem usuário). */
export const systemActor = (householdId: string) => ({
  householdId,
  userId: null,
  role: "system" as const,
});

export interface Decisions {
  /** `dedupe_key` de sugestões desfeitas: nunca mais aplicam sozinhas. */
  blocked: Set<string>;
  /** `dedupe_key` ignoradas há menos de 30 dias: não voltam para a fila. */
  recentlyIgnored: Set<string>;
}

/** O que a família já decidiu sobre as sugestões de um agente. */
export async function loadDecisions(
  tx: TenantTx,
  today: string,
  agent?: string,
): Promise<Decisions> {
  const since = new Date(`${shiftDays(today, -IGNORED_DAYS)}T00:00:00Z`);
  const rows = await tx
    .select({
      dedupeKey: householdSuggestions.dedupeKey,
      status: householdSuggestions.status,
      decidedAt: householdSuggestions.decidedAt,
    })
    .from(householdSuggestions)
    .where(
      and(
        inArray(householdSuggestions.status, ["desfeita", "ignorada"]),
        agent ? eq(householdSuggestions.agent, agent) : undefined,
      ),
    );
  const blocked = new Set<string>();
  const recentlyIgnored = new Set<string>();
  for (const row of rows) {
    if (row.status === "desfeita") blocked.add(row.dedupeKey);
    else if (row.decidedAt && row.decidedAt >= since) recentlyIgnored.add(row.dedupeKey);
  }
  return { blocked, recentlyIgnored };
}

export interface PendingSuggestion {
  kind: SuggestionKind;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

/**
 * Grava (ou atualiza) sugestões pendentes pelo índice parcial. Pula as ignoradas há menos de 30
 * dias e as desfeitas. Devolve quantas ficaram na fila.
 */
export async function upsertPending(
  tx: TenantTx,
  householdId: string,
  agent: string,
  decisions: Decisions,
  items: PendingSuggestion[],
): Promise<number> {
  let written = 0;
  for (const item of items) {
    if (decisions.recentlyIgnored.has(item.dedupeKey) || decisions.blocked.has(item.dedupeKey))
      continue;
    const title = clamp(item.title, MAX_TITLE);
    const body = clamp(item.body, MAX_BODY);
    const rows = await tx
      .insert(householdSuggestions)
      .values({
        householdId,
        agent,
        kind: item.kind,
        title,
        body,
        payload: item.payload,
        status: "pendente",
        appliedBy: "familia",
        dedupeKey: item.dedupeKey.slice(0, 160),
      })
      .onConflictDoUpdate({
        target: [householdSuggestions.householdId, householdSuggestions.dedupeKey],
        targetWhere: sql`status = 'pendente'`,
        set: { agent, kind: item.kind, title, body, payload: item.payload },
      })
      .returning({ id: householdSuggestions.id });
    written += rows.length;
  }
  return written;
}

/**
 * Registra uma alteração que o agente fez sozinho: fica como `aplicada` por `agente`, com o estado
 * anterior no payload, para a família desfazer. Devolve o id.
 */
export async function recordApplied(
  tx: TenantTx,
  householdId: string,
  agent: string,
  item: PendingSuggestion,
): Promise<string> {
  const [row] = await tx
    .insert(householdSuggestions)
    .values({
      householdId,
      agent,
      kind: item.kind,
      title: clamp(item.title, MAX_TITLE),
      body: clamp(item.body, MAX_BODY),
      payload: item.payload,
      status: "aplicada",
      appliedBy: "agente",
      dedupeKey: item.dedupeKey.slice(0, 160),
      decidedAt: new Date(),
    })
    .returning({ id: householdSuggestions.id });
  return row!.id;
}

/** Grava na mesma linha o que o agente fez: uma sugestão pendente, ou a mudança do dia que cresceu. */
export async function markApplied(
  tx: TenantTx,
  id: string,
  item: PendingSuggestion,
): Promise<void> {
  await tx
    .update(householdSuggestions)
    .set({
      title: clamp(item.title, MAX_TITLE),
      body: clamp(item.body, MAX_BODY),
      payload: item.payload,
      status: "aplicada",
      appliedBy: "agente",
      decidedAt: new Date(),
    })
    .where(eq(householdSuggestions.id, id));
}

/**
 * Fecha sem efeito uma sugestão pendente que a regra não permite. A chave muda porque ninguém decidiu
 * nada: com a chave antiga, ela contaria como "Agora não" e seguraria o estabelecimento por 30 dias.
 */
export async function closePending(tx: TenantTx, id: string, dedupeKey: string): Promise<void> {
  await tx
    .update(householdSuggestions)
    .set({
      status: "ignorada",
      appliedBy: "agente",
      dedupeKey: `fechada:${dedupeKey}`.slice(0, 160),
      decidedAt: new Date(),
    })
    .where(eq(householdSuggestions.id, id));
}

/**
 * Marca algo que o agente decidiu deixar de lado: fica como `ignorada`, sem pendência para a família,
 * e `loadDecisions` tira da fila por 30 dias.
 */
export async function recordSkipped(
  tx: TenantTx,
  householdId: string,
  agent: string,
  item: PendingSuggestion,
): Promise<void> {
  await tx.insert(householdSuggestions).values({
    householdId,
    agent,
    kind: item.kind,
    title: clamp(item.title, MAX_TITLE),
    body: clamp(item.body, MAX_BODY),
    payload: item.payload,
    status: "ignorada",
    appliedBy: "agente",
    dedupeKey: item.dedupeKey.slice(0, 160),
    decidedAt: new Date(),
  });
}

/** Relatório do dia: upsert por (família, tipo, dia). */
export async function saveDailyReport<K extends DailyReportKind>(
  tx: TenantTx,
  householdId: string,
  agent: string,
  kind: K,
  period: string,
  report: DailyReport<K>,
): Promise<void> {
  const data = report.data as Record<string, unknown>;
  const title = clamp(report.title, MAX_REPORT_TITLE);
  const summary = clamp(report.summary, MAX_REPORT_SUMMARY);
  await tx
    .insert(householdReports)
    .values({ householdId, agent, kind, period, title, summary, data })
    .onConflictDoUpdate({
      target: [householdReports.householdId, householdReports.kind, householdReports.period],
      set: { agent, title, summary, data },
    });
}

/**
 * Divisão do que sobra para os agentes de viagens e metas: a recebida em memória, senão a do
 * relatório de aposentadoria de hoje; null quando nenhuma existe (o agente pula).
 */
export async function resolveAllocation(
  tx: TenantTx,
  input: AgentInput,
): Promise<Allocation | null> {
  if (input.allocation) return input.allocation;
  const [row] = await tx
    .select({ data: householdReports.data })
    .from(householdReports)
    .where(
      and(
        eq(householdReports.kind, "aposentadoria"),
        eq(householdReports.period, input.today),
        gte(householdReports.createdAt, new Date(0)),
      ),
    )
    .orderBy(desc(householdReports.createdAt))
    .limit(1);
  const allocation = (row?.data as { allocation?: Allocation } | undefined)?.allocation;
  return allocation && typeof allocation.goalsBudget === "string" ? allocation : null;
}

export const ASSET_CLASS_LABELS: Record<string, string> = {
  acao: "Ações",
  fii: "Fundos imobiliários",
  etf_bdr: "ETFs e BDRs",
  renda_fixa: "Renda fixa",
  fundo: "Fundos",
  previdencia: "Previdência",
  exterior: "Exterior",
  outro: "Outros",
};
