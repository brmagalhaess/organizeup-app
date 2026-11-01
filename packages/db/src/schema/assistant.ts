// Assistente com IA (ADR-0018). Ver migrations/0019_assistente.sql.
import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { household, user } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const tokens = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);

export const INSIGHT_SCREENS = [
  "painel",
  "lancamentos",
  "calendario",
  "metas",
  "viagens",
  "investimentos",
  "proventos",
  "aposentadoria",
  "reserva",
  "dividas",
] as const;
export type InsightScreen = (typeof INSIGHT_SCREENS)[number];

/** Dicas da rotina da madrugada, já aprovadas pelo verificador. Ver migrations/0022_dicas.sql. */
export const householdInsights = pgTable(
  "household_insights",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    screen: text("screen", { enum: INSIGHT_SCREENS }).notNull(),
    destination: text("destination", { enum: INSIGHT_SCREENS }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    why: text("why").notNull(),
    priority: smallint("priority").notNull().default(2),
    status: text("status", { enum: ["ativa", "feita", "dispensada", "vencida"] })
      .notNull()
      .default("ativa"),
    day: date("day", { mode: "string" }).notNull(),
    expiresOn: date("expires_on", { mode: "string" }).notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    decidedAt: ts("decided_at"),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [unique().on(t.householdId, t.id), unique().on(t.householdId, t.day, t.dedupeKey)],
);

export const MEMORY_KINDS = ["fato", "preferencia", "objetivo"] as const;
export type HouseholdMemoryKind = (typeof MEMORY_KINDS)[number];

// `search` existe só no banco: é coluna gerada, usada direto em SQL.
/** O que a família pediu para lembrar. Ver migrations/0024_memoria_conhecimento.sql. */
export const householdMemories = pgTable(
  "household_memories",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: MEMORY_KINDS }).notNull(),
    content: text("content").notNull(),
    source: text("source", { enum: ["conversa", "familia"] })
      .notNull()
      .default("conversa"),
    confidence: smallint("confidence").notNull().default(2),
    expiresOn: date("expires_on", { mode: "string" }),
    supersededBy: text("superseded_by"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    index("household_memories_active_idx")
      .on(t.householdId, t.createdAt.desc())
      .where(sql`superseded_by IS NULL`),
    foreignKey({
      columns: [t.householdId, t.supersededBy],
      foreignColumns: [t.householdId, t.id],
    }).onDelete("cascade"),
  ],
);

/** Regras públicas com fonte, sem RLS, como market_quotes. O texto vem de knowledge-seed.ts. */
export const knowledgeChunks = pgTable("knowledge_chunks", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  slug: text("slug").notNull().unique(),
  topic: text("topic").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  reviewedOn: date("reviewed_on", { mode: "string" }).notNull(),
});

export const ASSISTANT_ROLES = ["user", "assistant"] as const;
export type AssistantRole = (typeof ASSISTANT_ROLES)[number];

/** Conversa de uma pessoa: o RLS confere família e pessoa. */
export const assistantThreads = pgTable(
  "assistant_threads",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    unique().on(t.householdId, t.userId, t.id),
    index("assistant_threads_recent_idx").on(t.householdId, t.userId, t.updatedAt),
  ],
);

/** Mensagens não mudam: sem UPDATE nem DELETE no RLS; somem com a conversa. */
export const assistantMessages = pgTable(
  "assistant_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    role: text("role", { enum: ASSISTANT_ROLES }).notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("assistant_messages_thread_idx").on(t.householdId, t.threadId, t.createdAt),
    foreignKey({
      columns: [t.householdId, t.userId, t.threadId],
      foreignColumns: [assistantThreads.householdId, assistantThreads.userId, assistantThreads.id],
    }).onDelete("cascade"),
  ],
);

/** Consumo por família, dia, rota e modelo. Só contagens, nunca texto. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    route: text("route").notNull(),
    model: text("model").notNull(),
    calls: integer("calls").notNull().default(0),
    inputTokens: tokens("input_tokens"),
    outputTokens: tokens("output_tokens"),
    cacheReadTokens: tokens("cache_read_tokens"),
    cacheWriteTokens: tokens("cache_write_tokens"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.day, t.route, t.model] })],
);
