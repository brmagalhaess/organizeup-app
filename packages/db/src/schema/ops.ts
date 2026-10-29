// Schema `ops`: dados operacionais SEM PII (lidos pelos agentes via Ops API).
import { bigint, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const opsSchema = pgSchema("ops");

export const deployments = opsSchema.table("deployments", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  service: text("service", { enum: ["web", "worker"] }).notNull(),
  commit: text("commit").notNull(),
  hostname: text("hostname"),
  startedAt: ts("started_at").notNull().defaultNow(),
});

export const workerHeartbeats = opsSchema.table("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  commit: text("commit").notNull(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  info: jsonb("info").$type<Record<string, unknown>>().notNull().default({}),
});
