// Planos e assinatura (ADR-0023). O catálogo é global; a assinatura é espelho do que a Stripe diz, e
// só o worker grava nela; o uso do mês é da família.
import type {
  BillingCycle,
  BillingModule,
  Currency,
  SubscribedItem,
  VipCost,
  VipScope,
} from "@organizeup/domain";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { household, user } from "./auth";
import { opsSchema } from "./ops";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const billingCatalog = pgTable("billing_catalog", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  item: text("item").notNull(),
  cycle: text("cycle").$type<BillingCycle>().notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("BRL"),
  stripePriceId: text("stripe_price_id"),
  onSale: boolean("on_sale").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const householdSubscriptions = pgTable("household_subscriptions", {
  householdId: text("household_id")
    .primaryKey()
    .references(() => household.id, { onDelete: "cascade" }),
  courtesy: boolean("courtesy").notNull().default(false),
  courtesyUntil: ts("courtesy_until"),
  courtesyReason: text("courtesy_reason"),
  trialEndsAt: ts("trial_ends_at"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  status: text("status"),
  cycle: text("cycle").$type<BillingCycle>(),
  items: jsonb("items").$type<SubscribedItem[]>().notNull().default([]),
  currentPeriodStart: ts("current_period_start"),
  currentPeriodEnd: ts("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  canceledAt: ts("canceled_at"),
  stripeScheduleId: text("stripe_schedule_id"),
  scheduledItems: jsonb("scheduled_items").$type<SubscribedItem[]>(),
  scheduledCycle: text("scheduled_cycle").$type<BillingCycle>(),
  scheduledAt: ts("scheduled_at"),
  scheduleEventAt: ts("schedule_event_at"),
  scheduleEndedId: text("schedule_ended_id"),
  firstPaidAt: ts("first_paid_at"),
  refundedAt: ts("refunded_at"),
  paymentFailedAt: ts("payment_failed_at"),
  lastEventAt: ts("last_event_at"),
  /** Desconto em vigor na Stripe, pela metadata da assinatura (ADR-0025). */
  discountPercent: integer("discount_percent"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Concessões VIP (ADR-0025). A família lê; só o painel grava, e remover é marcar. */
export const vipGrants = pgTable("vip_grants", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  householdId: text("household_id")
    .notNull()
    .references(() => household.id, { onDelete: "cascade" }),
  scope: text("scope").$type<VipScope>().notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  fullAccess: boolean("full_access").notNull().default(true),
  modules: jsonb("modules").$type<BillingModule[]>().notNull().default([]),
  entryLimit: integer("entry_limit"),
  messageLimit: integer("message_limit"),
  currencies: jsonb("currencies").$type<Currency[]>().notNull().default([]),
  cost: text("cost").$type<VipCost>().notNull(),
  discountPercent: integer("discount_percent"),
  reason: text("reason").notNull(),
  endsAt: ts("ends_at"),
  grantedBy: text("granted_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  revokedAt: ts("revoked_at"),
  revokedBy: text("revoked_by"),
});

export const householdUsage = pgTable(
  "household_usage",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    messages: integer("messages").notNull().default(0),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.month] })],
);

/**
 * `usage_month` fica fora de `transactions` e `card_purchases` no Drizzle, pelo mesmo motivo de `userAccess`:
 * todo `select()` leria a coluna, e a web cairia até o worker migrar. Só o limite do plano usa estas duas, e só
 * com a chave ligada, que por sua vez só existe depois da migração.
 */
export const transactionUsage = pgTable("transactions", {
  id: text("id").primaryKey(),
  usageMonth: text("usage_month"),
});

export const cardPurchaseUsage = pgTable("card_purchases", {
  id: text("id").primaryKey(),
  usageMonth: text("usage_month"),
});

/** Pagamento aberto por família: cliente da Stripe, sessão e trava. Só ids e datas. */
export const billingCheckouts = opsSchema.table("billing_checkouts", {
  householdId: text("household_id").primaryKey(),
  customerId: text("customer_id"),
  sessionId: text("session_id"),
  lockedUntil: ts("locked_until").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Eventos da Stripe: só ids, datas e a lista fechada de campos de `normalizeEvent`. Sem PII. */
export const billingEvents = opsSchema.table(
  "billing_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    stripeAt: ts("stripe_at").notNull(),
    livemode: boolean("livemode").notNull(),
    householdId: text("household_id"),
    customerId: text("customer_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
    attempts: integer("attempts").notNull().default(0),
    errorCode: text("error_code"),
  },
  (t) => [
    index("billing_events_pending_idx")
      .on(t.stripeAt)
      .where(sql`processed_at is null`),
  ],
);
