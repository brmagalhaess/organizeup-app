// Núcleo financeiro. Todas com RLS (exceto category_templates, global e somente leitura).
// Ver migrations/0004_financas.sql. Valores trafegam como string (numeric(14,2)).
import {
  boolean,
  char,
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

export const IMPORT_SOURCES = ["ofx", "csv"] as const;

export const importBatches = pgTable(
  "import_batches",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    source: text("source", { enum: IMPORT_SOURCES }).notNull(),
    rowCount: integer("row_count").notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    index("import_batches_household_id_idx").on(t.householdId),
    foreignKey({
      columns: [t.householdId, t.accountId],
      foreignColumns: [accounts.householdId, accounts.id],
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
    importFingerprint: text("import_fingerprint"),
    importBatchId: text("import_batch_id"),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    unique().on(t.householdId, t.planId, t.planMonth),
    unique("transactions_import_fingerprint_key").on(
      t.householdId,
      t.accountId,
      t.importFingerprint,
    ),
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

export const DEBT_SYSTEMS = ["price", "sac", "manual"] as const;
export type DebtSystem = (typeof DEBT_SYSTEMS)[number];

export const creditCards = pgTable(
  "credit_cards",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    limitAmount: amount("limit_amount"),
    closingDay: smallint("closing_day").notNull(),
    dueDay: smallint("due_day").notNull(),
    payingAccountId: text("paying_account_id").notNull(),
    archived: boolean("archived").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    index("credit_cards_household_id_idx").on(t.householdId),
    foreignKey({
      columns: [t.householdId, t.payingAccountId],
      foreignColumns: [accounts.householdId, accounts.id],
    }),
  ],
);

export const cardPurchases = pgTable(
  "card_purchases",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    cardId: text("card_id").notNull(),
    categoryId: text("category_id").notNull(),
    description: text("description").notNull(),
    amount: amount("amount").notNull(),
    installments: smallint("installments").notNull().default(1),
    purchasedOn: date("purchased_on", { mode: "string" }).notNull(),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    index("card_purchases_household_card_idx").on(t.householdId, t.cardId),
    foreignKey({
      columns: [t.householdId, t.cardId],
      foreignColumns: [creditCards.householdId, creditCards.id],
    }),
    foreignKey({
      columns: [t.householdId, t.categoryId],
      foreignColumns: [categories.householdId, categories.id],
    }),
  ],
);

export const cardStatementPayments = pgTable(
  "card_statement_payments",
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
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.cardId, t.statementMonth),
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

export const debts = pgTable(
  "debts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    name: text("name").notNull(),
    system: text("system", { enum: DEBT_SYSTEMS }).notNull(),
    monthlyRate: numeric("monthly_rate", { precision: 7, scale: 4 }).notNull().default("0"),
    originalBalance: amount("original_balance").notNull(),
    archived: boolean("archived").notNull().default(false),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    index("debts_household_id_idx").on(t.householdId),
    foreignKey({
      columns: [t.householdId, t.accountId],
      foreignColumns: [accounts.householdId, accounts.id],
    }),
  ],
);

export const debtInstallments = pgTable(
  "debt_installments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    debtId: text("debt_id").notNull(),
    number: smallint("number").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    amount: amount("amount").notNull(),
    principal: amount("principal").notNull(),
    interest: amount("interest").notNull(),
    transactionId: text("transaction_id"),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    unique().on(t.householdId, t.debtId, t.number),
    index("debt_installments_household_due_idx").on(t.householdId, t.dueDate),
    foreignKey({
      columns: [t.householdId, t.debtId],
      foreignColumns: [debts.householdId, debts.id],
    }).onDelete("cascade"),
    // Na migração é SET NULL só de transaction_id, para não apagar household_id.
    foreignKey({
      columns: [t.householdId, t.transactionId],
      foreignColumns: [transactions.householdId, transactions.id],
    }),
  ],
);

export const emergencyFund = pgTable("emergency_fund", {
  householdId: text("household_id")
    .primaryKey()
    .references(() => household.id, { onDelete: "cascade" }),
  targetMonths: smallint("target_months").notNull().default(6),
  monthlyAmount: amount("monthly_amount"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const earmarks = pgTable(
  "earmarks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    purpose: text("purpose", { enum: ["reserva"] }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.accountId, t.purpose),
    foreignKey({
      columns: [t.householdId, t.accountId],
      foreignColumns: [accounts.householdId, accounts.id],
    }),
  ],
);

export const ASSET_KINDS = ["imovel", "veiculo", "outro"] as const;

export const assets = pgTable(
  "assets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ASSET_KINDS }).notNull(),
    value: amount("value").notNull(),
    valuedOn: date("valued_on", { mode: "string" }).notNull(),
    linkedDebtId: text("linked_debt_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    index("assets_household_id_idx").on(t.householdId),
    // Na migração é SET NULL só de linked_debt_id, para não apagar household_id.
    foreignKey({
      columns: [t.householdId, t.linkedDebtId],
      foreignColumns: [debts.householdId, debts.id],
    }),
  ],
);

export const netWorthSnapshots = pgTable(
  "net_worth_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    month: char("month", { length: 7 }).notNull(),
    owned: numeric("owned", { precision: 16, scale: 2 }).notNull(),
    owed: numeric("owed", { precision: 16, scale: 2 }).notNull(),
    net: numeric("net", { precision: 16, scale: 2 }).notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.householdId, t.month)],
);

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    yearly: boolean("yearly").notNull().default(false),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    index("calendar_events_household_date_idx").on(t.householdId, t.eventDate),
  ],
);

export const fiscalParameters = pgTable("fiscal_parameters", {
  validFrom: char("valid_from", { length: 7 }).primaryKey(),
  source: text("source").notNull(),
  params: jsonb("params").notNull(),
});

export const INCOME_KINDS = [
  "clt",
  "pj_autonomo",
  "aposentadoria_pensao",
  "aluguel",
  "outro",
] as const;
export const INCOME_PARTS = ["salario", "ferias", "13-1", "13-2"] as const;

export const incomeSources = pgTable(
  "income_sources",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    personId: text("person_id"),
    accountId: text("account_id").notNull(),
    categoryId: text("category_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: INCOME_KINDS }).notNull(),
    amount: amount("amount").notNull(),
    isGross: boolean("is_gross").notNull().default(false),
    dependents: smallint("dependents").notNull().default(0),
    pensionAmount: amount("pension_amount").notNull().default("0"),
    otherDiscounts: amount("other_discounts").notNull().default("0"),
    vacationMonth: smallint("vacation_month"),
    payDay: smallint("pay_day").notNull(),
    startMonth: char("start_month", { length: 7 }).notNull(),
    endMonth: char("end_month", { length: 7 }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    index("income_sources_household_id_idx").on(t.householdId),
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

export const incomeReceipts = pgTable(
  "income_receipts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    incomeSourceId: text("income_source_id").notNull(),
    month: char("month", { length: 7 }).notNull(),
    part: text("part", { enum: INCOME_PARTS }).notNull(),
    transactionId: text("transaction_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.incomeSourceId, t.month, t.part),
    foreignKey({
      columns: [t.householdId, t.incomeSourceId],
      foreignColumns: [incomeSources.householdId, incomeSources.id],
    }),
    foreignKey({
      columns: [t.householdId, t.transactionId],
      foreignColumns: [transactions.householdId, transactions.id],
    }).onDelete("cascade"),
  ],
);

export const INVESTMENT_CLASSES = [
  "acao",
  "fii",
  "etf_bdr",
  "renda_fixa",
  "fundo",
  "previdencia",
  "exterior",
  "outro",
] as const;
export type InvestmentClass = (typeof INVESTMENT_CLASSES)[number];
export const TRADE_SIDES = ["compra", "venda"] as const;
export const DIVIDEND_KINDS = ["dividendo", "jcp", "rendimento"] as const;

const quantity = (name: string) => numeric(name, { precision: 20, scale: 8 });

export const investments = pgTable(
  "investments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ticker: text("ticker"),
    assetClass: text("asset_class", { enum: INVESTMENT_CLASSES }).notNull(),
    currentPrice: quantity("current_price"),
    currentValue: amount("current_value"),
    valuedOn: date("valued_on", { mode: "string" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    unique().on(t.householdId, t.ticker),
    index("investments_household_id_idx").on(t.householdId),
  ],
);

export const investmentTrades = pgTable(
  "investment_trades",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    investmentId: text("investment_id").notNull(),
    side: text("side", { enum: TRADE_SIDES }).notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    quantity: quantity("quantity").notNull(),
    unitPrice: quantity("unit_price").notNull(),
    fees: amount("fees").notNull().default("0"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("investment_trades_investment_idx").on(t.householdId, t.investmentId),
    foreignKey({
      columns: [t.householdId, t.investmentId],
      foreignColumns: [investments.householdId, investments.id],
    }).onDelete("cascade"),
  ],
);

export const dividends = pgTable(
  "dividends",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    investmentId: text("investment_id").notNull(),
    kind: text("kind", { enum: DIVIDEND_KINDS }).notNull(),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    gross: amount("gross").notNull(),
    withheld: amount("withheld").notNull().default("0"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("dividends_household_paid_idx").on(t.householdId, t.paidOn),
    foreignKey({
      columns: [t.householdId, t.investmentId],
      foreignColumns: [investments.householdId, investments.id],
    }).onDelete("cascade"),
  ],
);

export const investmentTargets = pgTable(
  "investment_targets",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    assetClass: text("asset_class", { enum: INVESTMENT_CLASSES }).notNull(),
    percent: numeric("percent", { precision: 5, scale: 2 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.assetClass] })],
);

export const dividendGoals = pgTable("dividend_goals", {
  householdId: text("household_id")
    .primaryKey()
    .references(() => household.id, { onDelete: "cascade" }),
  monthlyAmount: amount("monthly_amount").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const MEMORY_SOURCES = ["agente", "familia"] as const;

/** O que o agente de categorização aprendeu, por estabelecimento. */
export const categoryMemory = pgTable(
  "category_memory",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ENTRY_KINDS }).notNull(),
    merchant: text("merchant").notNull(),
    categoryId: text("category_id").notNull(),
    source: text("source", { enum: MEMORY_SOURCES }).notNull(),
    hits: integer("hits").notNull().default(1),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.kind, t.merchant] }),
    foreignKey({
      columns: [t.householdId, t.categoryId],
      foreignColumns: [categories.householdId, categories.id],
    }).onDelete("cascade"),
  ],
);

/** Relatórios dos agentes do produto, para consulta futura do assistente da família. */
export const householdReports = pgTable(
  "household_reports",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    agent: text("agent").notNull(),
    kind: text("kind", { enum: ["importacao"] }).notNull(),
    period: text("period").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.kind, t.period),
    index("household_reports_recent_idx").on(t.householdId, t.createdAt),
  ],
);
