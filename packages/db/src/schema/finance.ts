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
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { household } from "./auth";
import { people } from "./tenant";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const amount = (name: string) => numeric(name, { precision: 14, scale: 2 });

export const ENTRY_KINDS = ["receita", "despesa"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const ACCOUNT_TYPES = ["corrente", "poupanca", "dinheiro", "investimento"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ENTRY_STATUSES = ["previsto", "realizado"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
/** Quem escolheu a categoria do lançamento (ADR-0015). Null = lançamento antigo. */
export const CATEGORY_SOURCES = ["familia", "importacao", "revisar", "agente"] as const;
export type CategorySourceKind = (typeof CATEGORY_SOURCES)[number];

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
    categorySource: text("category_source", { enum: CATEGORY_SOURCES }),
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
  /** Gasto essencial informado pela família. Não é o aporte. */
  monthlyAmount: amount("monthly_amount"),
  /** Aporte mensal planejado para a reserva. Null = usa o sugerido pelo agente. */
  contribution: amount("contribution"),
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

/** Tipos de relatório por família. `importacao` é por lote; os demais são diários (period = dia). */
export const REPORT_KINDS = [
  "importacao",
  "categorias",
  "investimentos",
  "aposentadoria",
  "viagens",
  "metas",
] as const;
export type HouseholdReportKind = (typeof REPORT_KINDS)[number];

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
    kind: text("kind", { enum: REPORT_KINDS }).notNull(),
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

const percent = (name: string) => numeric(name, { precision: 5, scale: 2 });

/** Premissas de um cenário. O resultado é recalculado, nunca gravado. */
export const retirementScenarios = pgTable(
  "retirement_scenarios",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    personId: text("person_id").notNull(),
    name: text("name").notNull(),
    targetAge: smallint("target_age").notNull(),
    lifeExpectancy: smallint("life_expectancy").notNull(),
    targetIncome: amount("target_income").notNull(),
    otherIncome: amount("other_income").notNull().default("0"),
    monthlyContribution: amount("monthly_contribution").notNull().default("0"),
    /** Null usa o valor da carteira. */
    saved: amount("saved"),
    returnBefore: percent("return_before").notNull(),
    returnAfter: percent("return_after").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("retirement_scenarios_household_id_idx").on(t.householdId),
    foreignKey({
      columns: [t.householdId, t.personId],
      foreignColumns: [people.householdId, people.id],
    }).onDelete("cascade"),
  ],
);

export const trips = pgTable(
  "trips",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    destination: text("destination").notNull(),
    startOn: date("start_on", { mode: "string" }).notNull(),
    endOn: date("end_on", { mode: "string" }),
    saved: amount("saved").notNull().default("0"),
    calendarEventId: text("calendar_event_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    index("trips_household_id_idx").on(t.householdId),
    // Na migração é SET NULL só de calendar_event_id, para não apagar household_id.
    foreignKey({
      columns: [t.householdId, t.calendarEventId],
      foreignColumns: [calendarEvents.householdId, calendarEvents.id],
    }),
  ],
);

export const TRIP_COST_KINDS = [
  "passagem",
  "hospedagem",
  "alimentacao",
  "transporte",
  "passeios",
  "outros",
] as const;

export const tripCosts = pgTable(
  "trip_costs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    tripId: text("trip_id").notNull(),
    kind: text("kind", { enum: TRIP_COST_KINDS }).notNull(),
    amount: amount("amount").notNull(),
    perPerson: boolean("per_person").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("trip_costs_trip_idx").on(t.householdId, t.tripId),
    foreignKey({
      columns: [t.householdId, t.tripId],
      foreignColumns: [trips.householdId, trips.id],
    }).onDelete("cascade"),
  ],
);

export const tripPeople = pgTable(
  "trip_people",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    tripId: text("trip_id").notNull(),
    personId: text("person_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.tripId, t.personId] }),
    foreignKey({
      columns: [t.householdId, t.tripId],
      foreignColumns: [trips.householdId, trips.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.householdId, t.personId],
      foreignColumns: [people.householdId, people.id],
    }).onDelete("cascade"),
  ],
);

// ---------- Agentes diários, metas e plano por proventos (migração 0016; ADR-0015/0016) ----------

/** Plano de aposentadoria por renda de proventos (1:1). Null = o agente deriva. */
export const retirementPlan = pgTable("retirement_plan", {
  householdId: text("household_id")
    .primaryKey()
    .references(() => household.id, { onDelete: "cascade" }),
  targetIncome: amount("target_income"),
  expectedYield: percent("expected_yield"),
  dividendGrowth: percent("dividend_growth").notNull().default("0"),
  monthlyContribution: amount("monthly_contribution"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const GOAL_KINDS = [
  "veiculo",
  "imovel",
  "reforma",
  "educacao",
  "compra",
  "evento",
  "outro",
] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];
export const GOAL_STATUSES = ["planejando", "juntando", "concluida", "pausada"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Metas da família. Colunas `plan*` são derivadas: o agente recalcula todo dia. */
export const goals = pgTable(
  "goals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: GOAL_KINDS }).notNull(),
    targetAmount: amount("target_amount").notNull(),
    saved: amount("saved").notNull().default("0"),
    desiredMonth: char("desired_month", { length: 7 }),
    priority: smallint("priority").notNull().default(3),
    status: text("status", { enum: GOAL_STATUSES }).notNull().default("planejando"),
    planDay: smallint("plan_day").notNull().default(5),
    /** De onde sai a parcela. Obrigatória para haver parcelas. */
    accountId: text("account_id"),
    /** Onde o dinheiro fica (opcional). Com destino, o guardado já está no saldo da conta. */
    destinationAccountId: text("destination_account_id"),
    planStart: char("plan_start", { length: 7 }),
    planEnd: char("plan_end", { length: 7 }),
    planMonthly: amount("plan_monthly"),
    planNote: text("plan_note"),
    planUpdatedAt: ts("plan_updated_at"),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    index("goals_household_id_idx").on(t.householdId),
    // Na migração é SET NULL só de account_id / destination_account_id, para não apagar household_id.
    foreignKey({
      columns: [t.householdId, t.accountId],
      foreignColumns: [accounts.householdId, accounts.id],
    }),
    foreignKey({
      columns: [t.householdId, t.destinationAccountId],
      foreignColumns: [accounts.householdId, accounts.id],
    }),
  ],
);

/** Parcelas do plano. Sem `transactionId` é previsão do agente; com, a família confirmou. */
export const goalContributions = pgTable(
  "goal_contributions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    goalId: text("goal_id").notNull(),
    month: char("month", { length: 7 }).notNull(),
    amount: amount("amount").notNull(),
    transactionId: text("transaction_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    unique().on(t.householdId, t.goalId, t.month),
    index("goal_contributions_goal_idx").on(t.householdId, t.goalId),
    foreignKey({
      columns: [t.householdId, t.goalId],
      foreignColumns: [goals.householdId, goals.id],
    }).onDelete("cascade"),
    // Na migração é SET NULL só de transaction_id, para não apagar household_id.
    foreignKey({
      columns: [t.householdId, t.transactionId],
      foreignColumns: [transactions.householdId, transactions.id],
    }),
  ],
);

export const SUGGESTION_KINDS = [
  "categoria",
  "fusao_categoria",
  "aporte_reserva",
  "aporte_divida",
  "aporte_investimento",
  "viagem",
  "meta",
  "investimento",
  "lembrete",
] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];
export const SUGGESTION_STATUSES = ["pendente", "aplicada", "ignorada", "desfeita"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
export const SUGGESTION_APPLIERS = ["familia", "agente"] as const;
export type SuggestionApplier = (typeof SUGGESTION_APPLIERS)[number];

/**
 * Sugestões dos agentes. Alteração automática também fica aqui (`aplicada` por `agente`, estado
 * anterior no payload) para Desfazer. Upsert pelo índice parcial:
 * `.onConflictDoUpdate({ target: [householdId, dedupeKey], targetWhere: sql`status = 'pendente'`, set })`.
 */
export const householdSuggestions = pgTable(
  "household_suggestions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    agent: text("agent").notNull(),
    kind: text("kind", { enum: SUGGESTION_KINDS }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", { enum: SUGGESTION_STATUSES }).notNull().default("pendente"),
    appliedBy: text("applied_by", { enum: SUGGESTION_APPLIERS }).notNull().default("familia"),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    decidedAt: ts("decided_at"),
    decidedBy: text("decided_by"),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    uniqueIndex("household_suggestions_pending_dedupe")
      .on(t.householdId, t.dedupeKey)
      .where(sql`status = 'pendente'`),
    index("household_suggestions_status_idx").on(t.householdId, t.status, t.createdAt),
    index("household_suggestions_dedupe_idx").on(t.householdId, t.dedupeKey, t.status),
  ],
);

export const DESTINATION_REGIONS = [
  "brasil_perto",
  "brasil",
  "america_sul",
  "america_norte",
  "europa",
  "asia_oceania",
] as const;
export type DestinationRegion = (typeof DESTINATION_REGIONS)[number];
export const DESTINATION_CONFIDENCES = ["baixa", "media"] as const;
export type DestinationConfidence = (typeof DESTINATION_CONFIDENCES)[number];

/**
 * Referência global de custo por destino (somente leitura para a aplicação). Cada linha cita a
 * fonte real e o mês/ano em `source`. Hospedagem é por noite para até 4 pessoas; alimentação e
 * transporte por pessoa e dia; passagem ida e volta por pessoa saindo do Brasil. Passeios não
 * são estimados.
 */
export const tripDestinationTemplates = pgTable("trip_destination_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  country: char("country", { length: 2 }).notNull(),
  region: text("region", { enum: DESTINATION_REGIONS }).notNull(),
  lodgingPerNight: amount("lodging_per_night").notNull(),
  foodPerPersonDay: amount("food_per_person_day").notNull(),
  localTransportPerPersonDay: amount("local_transport_per_person_day").notNull(),
  flightPerPerson: amount("flight_per_person").notNull(),
  minDays: smallint("min_days").notNull().default(3),
  kidsFriendly: boolean("kids_friendly").notNull().default(true),
  /** Meses bons para ir, separados por vírgula (ex.: "1,2,7,12"). Vazio = qualquer mês. */
  bestMonths: text("best_months").notNull().default(""),
  source: text("source").notNull(),
  confidence: text("confidence", { enum: DESTINATION_CONFIDENCES }).notNull(),
  position: smallint("position").notNull().default(0),
});
