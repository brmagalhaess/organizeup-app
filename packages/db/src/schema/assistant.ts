// Assistente com IA (ADR-0018). Ver migrations/0019_assistente.sql.
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
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { household, user } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const tokens = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);

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
