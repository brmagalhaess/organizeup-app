// Lembretes por e-mail (ADR-0039). Migração 0053. Uma linha por login em cada família: a escolha da pessoa e
// até onde o aviso já foi. Sem linha, vale o padrão (tudo ligado).
import {
  boolean,
  char,
  date,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { household, user } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const emailReminders = pgTable(
  "email_reminders",
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
    enabled: boolean("enabled").notNull().default(true),
    bills: boolean("bills").notNull().default(true),
    income: boolean("income").notNull().default(true),
    dividends: boolean("dividends").notNull().default(true),
    expenses: boolean("expenses").notNull().default(true),
    /** Resumo mensal do plano de aposentadoria. */
    retirement: boolean("retirement").notNull().default(true),
    daysAhead: smallint("days_ahead").notNull().default(3),
    /** Dia do último resumo de vencimentos. */
    dailySentOn: date("daily_sent_on", { mode: "string" }),
    /** Até quando os gastos novos já foram avisados. */
    expensesSeenAt: ts("expenses_seen_at"),
    /** Mês do último resumo da aposentadoria. */
    retirementMonth: char("retirement_month", { length: 7 }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    unique().on(t.householdId, t.userId),
    index("email_reminders_household_id_idx").on(t.householdId),
  ],
);
