// Núcleo financeiro. Todas com RLS (exceto category_templates, global e somente leitura).
// Ver migrations/0004_financas.sql. Valores trafegam como string (numeric(14,2)).
import {
  boolean,
  char,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { household } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const amount = (name: string) => numeric(name, { precision: 14, scale: 2 });

export const ENTRY_KINDS = ["receita", "despesa"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const ACCOUNT_TYPES = ["corrente", "poupanca", "dinheiro", "investimento"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ENTRY_STATUSES = ["previsto", "realizado"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const categoryTemplates = pgTable("category_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ENTRY_KINDS }).notNull(),
  essential: boolean("essential").notNull().default(false),
  position: smallint("position").notNull().default(0),
});

export const accounts = pgTable(
  "accounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", { enum: ACCOUNT_TYPES }).notNull().default("corrente"),
    openingBalance: amount("opening_balance").notNull().default("0"),
    archived: boolean("archived").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.householdId, t.id), index("accounts_household_id_idx").on(t.householdId)],
);

export const categories = pgTable(
  "categories",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ENTRY_KINDS }).notNull(),
    essential: boolean("essential").notNull().default(false),
    position: smallint("position").notNull().default(100),
    archived: boolean("archived").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.householdId, t.id), unique().on(t.householdId, t.kind, t.name)],
);

export const cashflowPlans = pgTable(
  "cashflow_plans",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    categoryId: text("category_id").notNull(),
    kind: text("kind", { enum: ENTRY_KINDS }).notNull(),
    description: text("description").notNull(),
    amount: amount("amount").notNull(),
    dayOfMonth: smallint("day_of_month").notNull(),
    startMonth: char("start_month", { length: 7 }).notNull(),
    endMonth: char("end_month", { length: 7 }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    index("cashflow_plans_household_id_idx").on(t.householdId),
    foreignKey({
      columns: [t.householdId, t.accountId],
      foreignColumns: [accounts.householdId, accounts.id],
    }),
    foreignKey({
      columns: [t.householdId, t.categoryId],
      foreignColumns: [categories.householdId, categories.id],
    }),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    categoryId: text("category_id").notNull(),
    kind: text("kind", { enum: ENTRY_KINDS }).notNull(),
    description: text("description").notNull(),
    amount: amount("amount").notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    status: text("status", { enum: ENTRY_STATUSES }).notNull().default("realizado"),
    planId: text("plan_id"),
    planMonth: char("plan_month", { length: 7 }),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    unique().on(t.householdId, t.planId, t.planMonth),
    index("transactions_household_date_idx").on(t.householdId, t.occurredOn),
    foreignKey({
      columns: [t.householdId, t.accountId],
      foreignColumns: [accounts.householdId, accounts.id],
    }),
    foreignKey({
      columns: [t.householdId, t.categoryId],
      foreignColumns: [categories.householdId, categories.id],
    }),
    foreignKey({
      columns: [t.householdId, t.planId],
      foreignColumns: [cashflowPlans.householdId, cashflowPlans.id],
    }),
  ],
);
