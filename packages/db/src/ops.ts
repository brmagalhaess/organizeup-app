// Helpers do schema `ops` (sem PII; sem RLS de tenant).
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { tolerateSchemaLag } from "./access";
import { appPool } from "./client";
import {
  adminAccess,
  agentMemory,
  agentRuns,
  aiStats,
  categorizationStats,
  deployments,
  platformStats,
  reports,
  workerHeartbeats,
} from "./schema";

export async function recordDeployment(input: {
  service: "web" | "worker";
  commit: string;
  hostname?: string | undefined;
}): Promise<void> {
  await appPool()
    .db.insert(deployments)
    .values({ service: input.service, commit: input.commit, hostname: input.hostname ?? null });
}

export async function listDeployments(limit = 20) {
  return appPool()
    .db.select()
    .from(deployments)
    .orderBy(desc(deployments.startedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function recordWorkerHeartbeat(input: {
  workerId: string;
  commit: string;
  info?: Record<string, unknown>;
}): Promise<void> {
  await appPool()
    .db.insert(workerHeartbeats)
    .values({ workerId: input.workerId, commit: input.commit, info: input.info ?? {} })
    .onConflictDoUpdate({
      target: workerHeartbeats.workerId,
      set: { commit: input.commit, info: input.info ?? {}, lastSeenAt: sql`now()` },
    });
}

export async function listWorkerHeartbeats() {
  return appPool().db.select().from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastSeenAt));
}

export type MemoryKind = (typeof agentMemory.$inferInsert)["kind"];

/** Guarda uma memória. Com `supersedes`, a anterior sai das buscas. */
export async function addAgentMemory(input: {
  agent: string;
  kind: MemoryKind;
  content: string;
  sourceIssue?: string | undefined;
  supersedes?: number | undefined;
}) {
  const { db } = appPool();
  const [memory] = await db
    .insert(agentMemory)
    .values({
      agent: input.agent,
      kind: input.kind,
      content: input.content,
      sourceIssue: input.sourceIssue ?? null,
    })
    .returning();
  if (input.supersedes) {
    await db
      .update(agentMemory)
      .set({ supersededBy: memory!.id })
      .where(eq(agentMemory.id, input.supersedes));
  }
  return memory!;
}

/** Memórias vigentes, por relevância quando há busca; senão, as mais recentes. */
export async function findAgentMemories(input: {
  agent?: string | undefined;
  query?: string | undefined;
  limit?: number | undefined;
}) {
  const query = input.query?.trim();
  const match = sql`search @@ websearch_to_tsquery('portuguese', ${query ?? ""})`;
  return appPool()
    .db.select()
    .from(agentMemory)
    .where(
      and(
        isNull(agentMemory.supersededBy),
        input.agent ? eq(agentMemory.agent, input.agent) : undefined,
        query ? match : undefined,
      ),
    )
    .orderBy(
      ...(query ? [sql`ts_rank(search, websearch_to_tsquery('portuguese', ${query})) desc`] : []),
      desc(agentMemory.createdAt),
    )
    .limit(Math.min(Math.max(input.limit ?? 20, 1), 100));
}

export type ReportKind = (typeof reports.$inferInsert)["kind"];

export async function saveReport(input: {
  kind: ReportKind;
  period: string;
  agent: string;
  title: string;
  body: string;
}) {
  const { agent, title, body } = input;
  const [report] = await appPool()
    .db.insert(reports)
    .values(input)
    .onConflictDoUpdate({
      target: [reports.kind, reports.period],
      set: { agent, title, body, updatedAt: sql`now()` },
    })
    .returning();
  return report!;
}

export async function listReports(input: {
  kind?: string | undefined;
  limit?: number | undefined;
}) {
  return appPool()
    .db.select()
    .from(reports)
    .where(input.kind ? eq(reports.kind, input.kind as ReportKind) : undefined)
    .orderBy(desc(reports.updatedAt))
    .limit(Math.min(Math.max(input.limit ?? 10, 1), 50));
}

/** Verifica o banco e devolve a última migration aplicada. */
export async function databaseStatus(): Promise<{ ok: true; schemaVersion: string | null }> {
  const rows = await appPool().sql<{ version: string | null }[]>`
    select max(version) as version from public.schema_migrations`;
  return { ok: true, schemaVersion: rows[0]?.version ?? null };
}

export type CategorizationCounts = {
  rowCount: number;
  fromMemory: number;
  fromWords: number;
  unmatched: number;
  corrected: number;
  categoriesCreated: number;
};

/** Soma uma importação ao dia. Só contagens: nada identifica a família. */
export async function recordCategorizationStats(
  day: string,
  counts: CategorizationCounts,
): Promise<void> {
  const t = categorizationStats;
  await appPool()
    .db.insert(t)
    .values({ day, imports: 1, ...counts })
    .onConflictDoUpdate({
      target: t.day,
      set: {
        imports: sql`${t.imports} + 1`,
        rowCount: sql`${t.rowCount} + ${counts.rowCount}`,
        fromMemory: sql`${t.fromMemory} + ${counts.fromMemory}`,
        fromWords: sql`${t.fromWords} + ${counts.fromWords}`,
        unmatched: sql`${t.unmatched} + ${counts.unmatched}`,
        corrected: sql`${t.corrected} + ${counts.corrected}`,
        categoriesCreated: sql`${t.categoriesCreated} + ${counts.categoriesCreated}`,
      },
    });
}

export async function listCategorizationStats(limit = 14) {
  return appPool()
    .db.select()
    .from(categorizationStats)
    .orderBy(desc(categorizationStats.day))
    .limit(Math.min(Math.max(limit, 1), 90));
}

export type AgentRunCounts = {
  households: number;
  ok: number;
  failed: number;
  suggestions: number;
  applied: number;
  durationMs?: number | null | undefined;
};

/**
 * Registra a rodada de um agente diário no dia (`YYYY-MM-DD`). Repetir no mesmo dia SUBSTITUI as
 * contagens e soma 1 em `runs`. Só o worker (ou_worker) tem permissão de gravar.
 */
export async function recordAgentRun(
  day: string,
  agent: string,
  counts: AgentRunCounts,
): Promise<void> {
  const t = agentRuns;
  const values = {
    households: counts.households,
    ok: counts.ok,
    failed: counts.failed,
    suggestions: counts.suggestions,
    applied: counts.applied,
    durationMs: counts.durationMs ?? null,
  };
  await appPool()
    .db.insert(t)
    .values({ day, agent, runs: 1, ...values })
    .onConflictDoUpdate({
      target: [t.day, t.agent],
      set: { ...values, runs: sql`${t.runs} + 1`, finishedAt: sql`now()` },
    });
}

/** Rodadas dos últimos `limit` dias com execução (todos os agentes), do mais recente ao mais antigo. */
export async function listAgentRuns(limit = 14) {
  const t = agentRuns;
  const { db } = appPool();
  const recentDays = db
    .select({ day: t.day })
    .from(t)
    .groupBy(t.day)
    .orderBy(desc(t.day))
    .limit(Math.min(Math.max(limit, 1), 90));
  return db.select().from(t).where(inArray(t.day, recentDays)).orderBy(desc(t.day), asc(t.agent));
}

/** Diz se o agente já rodou no dia (usado no boot do worker para não repetir a rodada). */
export async function hasAgentRunToday(day: string, agent: string): Promise<boolean> {
  const rows = await appPool()
    .db.select({ day: agentRuns.day })
    .from(agentRuns)
    .where(and(eq(agentRuns.day, day), eq(agentRuns.agent, agent)))
    .limit(1);
  return rows.length > 0;
}

/** Registra um acesso do painel do serviço. Nunca receba o texto da busca aqui. */
export async function recordAdminAccess(input: {
  adminUserId: string;
  action: string;
  targetHouseholdId?: string | null | undefined;
  targetUserId?: string | null | undefined;
}): Promise<void> {
  await appPool()
    .db.insert(adminAccess)
    .values({
      adminUserId: input.adminUserId,
      action: input.action,
      targetHouseholdId: input.targetHouseholdId ?? null,
      targetUserId: input.targetUserId ?? null,
    });
}

export type PlatformCounts = {
  households: number;
  users: number;
  active7d: number;
  active30d: number;
  useEntries: number;
  useInvestments: number;
  useGoals: number;
  useTrips: number;
  useRetirement: number;
};

/** Grava a fotografia do dia; repetir substitui. Só o worker (ou_worker) tem permissão. */
export async function recordPlatformStats(day: string, counts: PlatformCounts): Promise<void> {
  await appPool()
    .db.insert(platformStats)
    .values({ day, ...counts })
    .onConflictDoUpdate({
      target: platformStats.day,
      set: { ...counts, computedAt: sql`now()` },
    });
}

/** Linhas diárias, da mais recente para a mais antiga. */
export async function listPlatformStats(limit = 84) {
  return tolerateSchemaLag(
    () =>
      appPool()
        .db.select()
        .from(platformStats)
        .orderBy(desc(platformStats.day))
        .limit(Math.min(Math.max(limit, 1), 400)),
    [],
  );
}

export interface AiUsageCounts {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Decimal em string, como vem do numeric. */
  costUsd: string;
}

/** Soma o uso do dia e da rota. Sem família: é a base do teto mensal. */
export async function recordAiStats(
  day: string,
  route: string,
  counts: AiUsageCounts,
): Promise<void> {
  await appPool()
    .db.insert(aiStats)
    .values({ day, route, ...counts })
    .onConflictDoUpdate({
      target: [aiStats.day, aiStats.route],
      set: {
        calls: sql`${aiStats.calls} + excluded.calls`,
        inputTokens: sql`${aiStats.inputTokens} + excluded.input_tokens`,
        outputTokens: sql`${aiStats.outputTokens} + excluded.output_tokens`,
        cacheReadTokens: sql`${aiStats.cacheReadTokens} + excluded.cache_read_tokens`,
        cacheWriteTokens: sql`${aiStats.cacheWriteTokens} + excluded.cache_write_tokens`,
        costUsd: sql`${aiStats.costUsd} + excluded.cost_usd`,
        updatedAt: sql`now()`,
      },
    });
}

/** Somas do mês (`AAAA-MM`) para o teto e para o painel. Sem a tabela ainda, tudo zero. */
export async function aiMonthTotals(month: string): Promise<AiUsageCounts> {
  const empty: AiUsageCounts = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: "0",
  };
  return tolerateSchemaLag(async () => {
    const [row] = await appPool()
      .db.select({
        calls: sql<number>`coalesce(sum(${aiStats.calls}), 0)::int`,
        inputTokens: sql<number>`coalesce(sum(${aiStats.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${aiStats.outputTokens}), 0)::bigint`,
        cacheReadTokens: sql<number>`coalesce(sum(${aiStats.cacheReadTokens}), 0)::bigint`,
        cacheWriteTokens: sql<number>`coalesce(sum(${aiStats.cacheWriteTokens}), 0)::bigint`,
        costUsd: sql<string>`coalesce(sum(${aiStats.costUsd}), 0)::text`,
      })
      .from(aiStats)
      .where(sql`to_char(${aiStats.day}, 'YYYY-MM') = ${month}`);
    if (!row) return empty;
    return {
      calls: Number(row.calls),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      cacheReadTokens: Number(row.cacheReadTokens),
      cacheWriteTokens: Number(row.cacheWriteTokens),
      costUsd: row.costUsd,
    };
  }, empty);
}

export interface QueueCount {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  lastFinishedAt: Date | null;
}

/**
 * Contagens das filas do pg-boss. Vai direto em pgboss.job porque os totais de pgboss.queue dependem
 * da supervisão, desligada aqui (o worker roda sem DDL).
 */
export async function listQueueCounts(): Promise<QueueCount[]> {
  const rows = await appPool().sql<
    {
      name: string;
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      last_finished: Date | null;
    }[]
  >`
    select q.name,
      count(j.id) filter (where j.state in ('created', 'retry'))::int as waiting,
      count(j.id) filter (where j.state = 'active')::int as active,
      count(j.id) filter (where j.state = 'completed')::int as completed,
      count(j.id) filter (where j.state = 'failed')::int as failed,
      max(j.completed_on) as last_finished
    from pgboss.queue q
    left join pgboss.job j on j.name = q.name
    where q.name not like '\_\_pgboss%'
    group by q.name
    order by q.name`;
  return rows.map(({ last_finished, ...row }) => ({
    ...row,
    lastFinishedAt: last_finished ? new Date(last_finished) : null,
  }));
}
