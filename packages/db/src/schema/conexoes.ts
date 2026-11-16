// Conexão com bancos pela Pluggy, com a chave de cada pessoa (ADR-0038). Migração 0050.
// As chaves ficam cifradas: nada aqui é legível sem `DOCUMENT_ENCRYPTION_KEY`.
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  smallint,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { household, user } from "./auth";
import { accounts, creditCards } from "./finance";
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
    /** Traz sozinho o que cair no banco. A pessoa pode desligar. */
    autoEnabled: boolean("auto_enabled").notNull().default(true),
    /** Última rodada automática: é também a trava entre duas rodadas ao mesmo tempo. */
    autoRanAt: ts("auto_ran_at"),
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
    /** Cartão do OrganizeUp que recebe as compras. Null: ainda não ligado, ou a linha é de conta. */
    cardId: text("card_id"),
    /** Dias do cartão informados pela instituição, só para sugerir no formulário. */
    closingDay: smallint("closing_day"),
    dueDay: smallint("due_day"),
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
    uniqueIndex("bank_connection_accounts_card_key")
      .on(t.householdId, t.cardId)
      .where(sql`${t.cardId} IS NOT NULL`),
    foreignKey({
      columns: [t.householdId, t.cardId],
      foreignColumns: [creditCards.householdId, creditCards.id],
    }),
  ],
);

/**
 * Impressão digital das compras que vieram de uma conexão (migração 0051). É outra vista de `card_purchases`,
 * como `cardPurchaseUsage`: quem lê compras no painel não passa a depender da coluna nova, e uma web publicada
 * antes da migração continua abrindo.
 */
export const cardPurchaseImports = pgTable("card_purchases", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  cardId: text("card_id").notNull(),
  importFingerprint: text("import_fingerprint"),
});

/**
 * De quem é cada conta e cada cartão (migração 0054). São outras vistas de `accounts` e `credit_cards`, pelo
 * mesmo motivo de `cardPurchaseImports`: quem lê contas no painel não passa a depender da coluna nova, e uma
 * web publicada antes da migração continua abrindo.
 */
export const accountOwners = pgTable("accounts", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  personId: text("person_id"),
});

export const cardOwners = pgTable("credit_cards", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  personId: text("person_id"),
});

/**
 * A transferência com o que veio do banco (migração 0055), na mesma tabela de `accountTransfers`. Fica à
 * parte porque a web nova pode rodar antes da migração: quem lê ou grava estas colunas tolera a falta delas.
 */
export const transferImports = pgTable("account_transfers", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  householdId: text("household_id").notNull(),
  fromAccountId: text("from_account_id").notNull(),
  toAccountId: text("to_account_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  toAmount: numeric("to_amount", { precision: 14, scale: 2 }),
  occurredOn: date("occurred_on", { mode: "string" }).notNull(),
  note: text("note"),
  toNote: text("to_note"),
  fromFingerprint: text("from_fingerprint"),
  toFingerprint: text("to_fingerprint"),
  createdBy: text("created_by"),
});
