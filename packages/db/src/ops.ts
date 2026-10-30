// Helpers do schema `ops` (sem PII; sem RLS de tenant).
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { appPool } from "./client";
import { agentMemory, deployments, reports, workerHeartbeats } from "./schema";

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
