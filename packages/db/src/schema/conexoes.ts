// Conexão com bancos pela Pluggy, com a chave de cada pessoa (ADR-0038). Migração 0050.
// As chaves ficam cifradas: nada aqui é legível sem `DOCUMENT_ENCRYPTION_KEY`.
import { sql } from "drizzle-orm";
import {
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { household, user } from "./auth";
import { accounts } from "./finance";
import { people } from "./tenant";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const BANK_PROVIDERS = ["pluggy"] as const;
export type BankProvider = (typeof BANK_PROVIDERS)[number];
export const BANK_ACCOUNT_KINDS = ["corrente", "poupanca", "cartao"] as const;
export type BankAccountKind = (typeof BANK_ACCOUNT_KINDS)[number];

export const bankConnections = pgTable(
  "bank_connections",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    /** Quem guardou a chave: só este login vê, usa e remove. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** De quem são as contas: a pessoa do cadastro que criou a chave na Pluggy. */
    personId: text("person_id").notNull(),
    provider: text("provider", { enum: BANK_PROVIDERS }).notNull().default("pluggy"),
    clientIdSealed: text("client_id_sealed").notNull(),
    clientSecretSealed: text("client_secret_sealed").notNull(),
    itemIds: text("item_ids").array().notNull(),
    checkedAt: ts("checked_at"),
    errorCode: text("error_code"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    unique().on(t.householdId, t.personId, t.provider),
    index("bank_connections_household_id_idx").on(t.householdId),
    index("bank_connections_user_id_idx").on(t.householdId, t.userId),
    foreignKey({
      columns: [t.householdId, t.personId],
      foreignColumns: [people.householdId, people.id],
    }).onDelete("cascade"),
  ],
);

export const bankConnectionAccounts = pgTable(
  "bank_connection_accounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull(),
    itemId: text("item_id").notNull(),
    externalId: text("external_id").notNull(),
    kind: text("kind", { enum: BANK_ACCOUNT_KINDS }).notNull(),
    name: text("name").notNull(),
    numberTail: text("number_tail"),
    currency: text("currency").notNull().default("BRL"),
    /** Conta do OrganizeUp que recebe os lançamentos. Null: ainda não ligada. */
    accountId: text("account_id"),
    syncedOn: date("synced_on", { mode: "string" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    unique().on(t.householdId, t.connectionId, t.externalId),
    index("bank_connection_accounts_household_id_idx").on(t.householdId),
    uniqueIndex("bank_connection_accounts_account_key")
      .on(t.householdId, t.accountId)
      .where(sql`${t.accountId} IS NOT NULL`),
    foreignKey({
      columns: [t.householdId, t.connectionId],
      foreignColumns: [bankConnections.householdId, bankConnections.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.householdId, t.accountId],
      foreignColumns: [accounts.householdId, accounts.id],
    }),
  ],
);
