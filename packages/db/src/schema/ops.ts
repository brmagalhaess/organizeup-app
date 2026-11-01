// Schema `ops`: dados operacionais SEM PII (lidos pelos agentes via Ops API).
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
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

/** Uma linha por dia e agente diário do produto. Só contagens; só o worker grava. */
export const agentRuns = opsSchema.table(
  "agent_runs",
  {
    day: date("day", { mode: "string" }).notNull(),
    agent: text("agent").notNull(),
    runs: integer("runs").notNull().default(1),
    households: integer("households").notNull().default(0),
    ok: integer("ok").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    suggestions: integer("suggestions").notNull().default(0),
    applied: integer("applied").notNull().default(0),
    durationMs: integer("duration_ms"),
    finishedAt: ts("finished_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.day, t.agent] })],
);

/** Cada acesso do painel do serviço. Nunca guarda o texto da busca; só a web grava. */
export const adminAccess = opsSchema.table("admin_access", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  at: ts("at").notNull().defaultNow(),
  adminUserId: text("admin_user_id").notNull(),
  action: text("action").notNull(),
  targetHouseholdId: text("target_household_id"),
  targetUserId: text("target_user_id"),
});

/** Chaves do sistema. Tudo desligado por padrão; só o painel grava, web e worker leem. */
export const featureFlags = opsSchema.table("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

/** Fotografia diária da plataforma, só contagens. Só o worker grava. */
export const platformStats = opsSchema.table("platform_stats", {
  day: date("day", { mode: "string" }).primaryKey(),
  households: integer("households").notNull().default(0),
  users: integer("users").notNull().default(0),
  active7d: integer("active_7d").notNull().default(0),
  active30d: integer("active_30d").notNull().default(0),
  useEntries: integer("use_entries").notNull().default(0),
  useInvestments: integer("use_investments").notNull().default(0),
  useGoals: integer("use_goals").notNull().default(0),
  useTrips: integer("use_trips").notNull().default(0),
  useRetirement: integer("use_retirement").notNull().default(0),
  computedAt: ts("computed_at").notNull().defaultNow(),
});

/** Somas do uso de IA por dia e rota, sem família. Daqui sai o gasto do mês contra o teto. */
export const aiStats = opsSchema.table(
  "ai_stats",
  {
    day: date("day", { mode: "string" }).notNull(),
    route: text("route").notNull(),
    calls: integer("calls").notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }).notNull().default(0),
    cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }).notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 14, scale: 6 }).notNull().default("0"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.day, t.route] })],
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
