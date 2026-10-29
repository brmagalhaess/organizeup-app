// Helpers do schema `ops` (sem PII; sem RLS de tenant).
import { desc, sql } from "drizzle-orm";
import { appPool } from "./client";
import { deployments, workerHeartbeats } from "./schema";

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

/** Verifica o banco e devolve a última migration aplicada. */
export async function databaseStatus(): Promise<{ ok: true; schemaVersion: string | null }> {
  const rows = await appPool().sql<{ version: string | null }[]>`
    select max(version) as version from public.schema_migrations`;
  return { ok: true, schemaVersion: rows[0]?.version ?? null };
}
