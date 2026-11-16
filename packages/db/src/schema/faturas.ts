// Pagamento de fatura em mais de uma vez (ADR-0043). Migração 0056. O pagamento principal continua em
// `cardStatementPayments`; aqui ficam os outros lançamentos ligados à mesma fatura. A web nova pode rodar
// antes da migração: quem lê ou grava esta tabela tolera a falta dela (`isSchemaLag`).
import {
  char,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { household } from "./auth";
import { creditCards, transactions } from "./finance";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const cardStatementParts = pgTable(
  "card_statement_parts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    cardId: text("card_id").notNull(),
    statementMonth: char("statement_month", { length: 7 }).notNull(),
    transactionId: text("transaction_id").notNull(),
    /** Quanto este débito tirou do pagamento marcado à mão: volta para ele se a ligação for desfeita. */
    replacedAmount: numeric("replaced_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    /** Categoria do lançamento antes de ser ligado, para devolver. */
    previousCategoryId: text("previous_category_id"),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    unique().on(t.householdId, t.transactionId),
    index("card_statement_parts_household_id_idx").on(t.householdId),
    index("card_statement_parts_statement_idx").on(t.householdId, t.cardId, t.statementMonth),
    foreignKey({
      columns: [t.householdId, t.cardId],
      foreignColumns: [creditCards.householdId, creditCards.id],
    }),
    foreignKey({
      columns: [t.householdId, t.transactionId],
      foreignColumns: [transactions.householdId, transactions.id],
    }).onDelete("cascade"),
  ],
);
