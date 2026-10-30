// Schema `ops`: dados operacionais SEM PII (lidos pelos agentes via Ops API).
import {
  bigint,
  date,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

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

// `search` existe só no banco: é coluna gerada, usada direto em SQL.
export const agentMemory = opsSchema.table("agent_memory", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  agent: text("agent").notNull(),
  kind: text("kind", { enum: ["fato", "decisao", "licao", "preferencia"] }).notNull(),
  content: text("content").notNull(),
  sourceIssue: text("source_issue"),
  supersededBy: bigint("superseded_by", { mode: "number" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const reports = opsSchema.table(
  "reports",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    kind: text("kind", {
      enum: ["saude", "semanal", "incidente", "custos", "produto"],
    }).notNull(),
    period: text("period").notNull(),
    agent: text("agent").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.kind, t.period)],
);

/** Contagens diárias do agente de categorização, sem família nem descrição. */
export const categorizationStats = opsSchema.table("categorization_stats", {
  day: date("day", { mode: "string" }).primaryKey(),
  imports: integer("imports").notNull().default(0),
  rowCount: integer("row_count").notNull().default(0),
  fromMemory: integer("from_memory").notNull().default(0),
  fromWords: integer("from_words").notNull().default(0),
  unmatched: integer("unmatched").notNull().default(0),
  corrected: integer("corrected").notNull().default(0),
  categoriesCreated: integer("categories_created").notNull().default(0),
});
