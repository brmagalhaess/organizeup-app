// Núcleo financeiro. Todas com RLS, exceto as globais: category_templates, a tabela de destinos e as
// de mercado.
// Ver migrations/0004_financas.sql. Valores trafegam como string (numeric(14,2)).
import {
  boolean,
  char,
  customType,
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
import {
  CURRENCIES,
  FX_CURRENCIES,
  STATEMENT_KINDS,
  STATEMENT_STATUSES,
  THIRTEENTH_MODES,
  type StatementData,
} from "@organizeup/domain";
import { household, user } from "./auth";
import { people } from "./tenant";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const amount = (name: string) => numeric(name, { precision: 14, scale: 2 });
const bytes = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
});

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
    /** Saldo inicial e movimento na moeda da conta (ADR-0020). */
    openingBalance: amount("opening_balance").notNull().default("0"),
    currency: text("currency", { enum: CURRENCIES }).notNull().default("BRL"),
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
    /** Sempre na moeda principal da família, em qualquer conta: é o que os resumos somam (ADR-0020). */
    amount: amount("amount").notNull(),
    /** Em conta estrangeira, o valor na moeda da conta e a cotação congelada. Nulas na moeda principal. */
    originalAmount: amount("original_amount"),
    originalCurrency: text("original_currency", { enum: FX_CURRENCIES }),
    fxRate: numeric("fx_rate", { precision: 20, scale: 8 }),
    /** O mesmo, em conta em real de família em dólar ou euro: `original_currency` não aceita BRL. */
    brlAmount: amount("brl_amount"),
    brlRate: numeric("brl_rate", { precision: 20, scale: 8 }),
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

export const DEBT_DOCUMENT_STATUSES = [
  "guardado",
  "lendo",
  "lido",
  "falhou",
  "confirmado",
] as const;
export type DebtDocumentStatus = (typeof DEBT_DOCUMENT_STATUSES)[number];

/**
 * Arquivos das dívidas (ADR-0019). `select()` sem colunas traz `content`, que pesa até 10 MB por
 * linha: listagem usa `debtDocumentMeta`, e só baixar e ler selecionam o conteúdo.
 */
export const debtDocuments = pgTable(
  "debt_documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    debtId: text("debt_id"),
    fileName: text("file_name").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    content: bytes("content").notNull(),
    sha256: text("sha256").notNull(),
    status: text("status", { enum: DEBT_DOCUMENT_STATUSES }).notNull().default("guardado"),
    extracted: jsonb("extracted").$type<Record<string, unknown>>(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    unique().on(t.householdId, t.sha256),
    index("debt_documents_debt_idx").on(t.householdId, t.debtId),
    index("debt_documents_recent_idx").on(t.householdId, t.createdAt),
    foreignKey({
      columns: [t.householdId, t.debtId],
      foreignColumns: [debts.householdId, debts.id],
    }).onDelete("cascade"),
  ],
);

/** Tudo de `debt_documents`, menos o conteúdo do arquivo. */
export const debtDocumentMeta = {
  id: debtDocuments.id,
  householdId: debtDocuments.householdId,
  debtId: debtDocuments.debtId,
  fileName: debtDocuments.fileName,
  mediaType: debtDocuments.mediaType,
  sizeBytes: debtDocuments.sizeBytes,
  sha256: debtDocuments.sha256,
  status: debtDocuments.status,
  extracted: debtDocuments.extracted,
  createdBy: debtDocuments.createdBy,
  createdAt: debtDocuments.createdAt,
  updatedAt: debtDocuments.updatedAt,
};

/** Aceite da família para o arquivo inteiro ir ao serviço de IA. Sem a linha, nada vai (ADR-0019). */
export const householdFileConsents = pgTable("household_file_consents", {
  householdId: text("household_id")
    .primaryKey()
    .references(() => household.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  acceptedBy: text("accepted_by").references(() => user.id, { onDelete: "set null" }),
  acceptedAt: ts("accepted_at").notNull().defaultNow(),
});

/** Plano de saída das dívidas, um por dia. Dado derivado, reescrito pelo agente `dividas`. */
export const debtPlanReports = pgTable(
  "debt_plan_reports",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    messageKey: text("message_key"),
    messageParams: jsonb("message_params").$type<Record<string, unknown>>(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.householdId, t.id), unique().on(t.householdId, t.day)],
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

export const VACATION_RECEIPT_PARTS = ["ferias-2", "ferias-3"] as const;

/** Escolhas de 13º e férias, do ano em diante (ADR-0028). Dado informado: o agente nunca muda. */
export const incomeYearPlans = pgTable(
  "income_year_plans",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    incomeSourceId: text("income_source_id").notNull(),
    year: smallint("year").notNull(),
    thirteenthMode: text("thirteenth_mode", { enum: THIRTEENTH_MODES })
      .notNull()
      .default("parcelas"),
    thirteenthFirstMonth: smallint("thirteenth_first_month").notNull().default(11),
    thirteenthSecondMonth: smallint("thirteenth_second_month").notNull().default(12),
    thirteenthWithVacation: boolean("thirteenth_with_vacation").notNull().default(false),
    thirteenthFirstReceived: boolean("thirteenth_first_received").notNull().default(false),
    thirteenthFirstAmount: amount("thirteenth_first_amount"),
    thirteenthSingleReceived: boolean("thirteenth_single_received").notNull().default(false),
    jobStartedOn: date("job_started_on"),
    vacationSoldDays: smallint("vacation_sold_days").notNull().default(0),
    vacationPeriods: jsonb("vacation_periods").notNull().default([]),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    unique().on(t.householdId, t.incomeSourceId, t.year),
    foreignKey({
      columns: [t.householdId, t.incomeSourceId],
      foreignColumns: [incomeSources.householdId, incomeSources.id],
    }).onDelete("cascade"),
  ],
);

/** Baixa do 2º e do 3º período de férias. O 1º continua em `income_receipts`. */
export const incomeVacationReceipts = pgTable(
  "income_vacation_receipts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    incomeSourceId: text("income_source_id").notNull(),
    month: char("month", { length: 7 }).notNull(),
    part: text("part", { enum: VACATION_RECEIPT_PARTS }).notNull(),
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
export const PRICE_SOURCES = ["familia", "mercado"] as const;
export const DIVIDEND_SOURCES = ["familia", "agente"] as const;
export const MARKET_INDEX_CODES = ["CDI", "SELIC", "IPCA"] as const;
export type MarketIndexCode = (typeof MARKET_INDEX_CODES)[number];
export const MARKET_TICKER_STATUSES = ["ok", "desconhecido", "sem_plano", "falha"] as const;
export type MarketTickerStatus = (typeof MARKET_TICKER_STATUSES)[number];

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
    /** Quem informou o preço atual (ADR-0017). */
    priceSource: text("price_source", { enum: PRICE_SOURCES }).notNull().default("familia"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    unique().on(t.householdId, t.ticker),
    index("investments_household_id_idx").on(t.householdId),
  ],
);

/** Fora de `transactions`: só muda o saldo das contas, sem entrar nos resumos do mês. */
export const accountTransfers = pgTable(
  "account_transfers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    fromAccountId: text("from_account_id").notNull(),
    toAccountId: text("to_account_id").notNull(),
    /** O que saiu da conta de origem, na moeda dela. */
    amount: amount("amount").notNull(),
    /** O que entrou na de destino, na moeda dela. Null: mesma moeda, mesmo valor nas duas pontas. */
    toAmount: amount("to_amount"),
    /** Reais por unidade estrangeira; entre duas estrangeiras, destino por unidade de origem. */
    fxRate: numeric("fx_rate", { precision: 20, scale: 8 }),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    foreignKey({
      columns: [t.householdId, t.fromAccountId],
      foreignColumns: [accounts.householdId, accounts.id],
    }),
    foreignKey({
      columns: [t.householdId, t.toAccountId],
      foreignColumns: [accounts.householdId, accounts.id],
    }),
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
    /** Lançamento que mexeu na conta. Null: a família não escolheu conta. */
    transactionId: text("transaction_id"),
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

/**
 * Evento em ações aplicado à carteira (ADR-0017). As operações não mudam: `positionOf` aplica isto por
 * cima. Dado derivado, com Desfazer (regra 7).
 */
export const investmentStockEvents = pgTable(
  "investment_stock_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    investmentId: text("investment_id").notNull(),
    comDate: date("com_date", { mode: "string" }).notNull(),
    factor: quantity("factor").notNull(),
    note: text("note").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.investmentId, t.comDate, t.note),
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
    /** `agente` = criado a partir de market_dividends (ADR-0017). */
    source: text("source", { enum: DIVIDEND_SOURCES }).notNull().default("familia"),
    marketDividendId: text("market_dividend_id").references(() => marketDividends.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("dividends_household_paid_idx").on(t.householdId, t.paidOn),
    uniqueIndex("dividends_market_dividend_unique")
      .on(t.householdId, t.investmentId, t.marketDividendId)
      .where(sql`market_dividend_id IS NOT NULL`),
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

/**
 * Tabelas de mercado (ADR-0017): globais, sem household_id e sem RLS de tenant. Guardam fatos públicos
 * da bolsa e do Banco Central. Todos leem; só ou_worker grava (grants no migrador).
 */
/** Catálogo da bolsa: uma chamada do job de mercado traz a lista inteira. */
export const marketAssets = pgTable("market_assets", {
  ticker: text("ticker").primaryKey(),
  name: text("name").notNull(),
  assetClass: text("asset_class", { enum: ["acao", "fii", "etf_bdr"] }).notNull(),
  sector: text("sector"),
  close: quantity("close"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const marketQuotes = pgTable("market_quotes", {
  ticker: text("ticker").primaryKey(),
  price: quantity("price").notNull(),
  changePercent: numeric("change_percent", { precision: 10, scale: 4 }),
  quotedAt: ts("quoted_at").notNull(),
  source: text("source").notNull(),
  /** Último desdobramento, grupamento ou bonificação. A lista completa fica em market_stock_events. */
  lastStockEventOn: date("last_stock_event_on", { mode: "string" }),
  lastStockEventNote: text("last_stock_event_note"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** `ratePerShare` é o valor pago na data, sem o ajuste por desdobramento que a fonte aplica. */
export const marketDividends = pgTable(
  "market_dividends",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ticker: text("ticker").notNull(),
    kind: text("kind", { enum: DIVIDEND_KINDS }).notNull(),
    comDate: date("com_date", { mode: "string" }).notNull(),
    exDate: date("ex_date", { mode: "string" }),
    payDate: date("pay_date", { mode: "string" }).notNull(),
    ratePerShare: quantity("rate_per_share").notNull(),
    seq: smallint("seq").notNull().default(1),
    source: text("source").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.ticker, t.kind, t.comDate, t.payDate, t.seq),
    index("market_dividends_ticker_idx").on(t.ticker, t.comDate),
  ],
);

export const marketIndices = pgTable(
  "market_indices",
  {
    code: text("code", { enum: MARKET_INDEX_CODES }).notNull(),
    date: date("date", { mode: "string" }).notNull(),
    value: quantity("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.code, t.date] })],
);

/** `factor` é o que a fonte manda: ações novas por ação antiga (0,1 num grupamento de 10 para 1). */
/** PTAX de venda em reais por unidade (ADR-0020). Global; depois de gravada, não muda. */
export const marketFx = pgTable(
  "market_fx",
  {
    currency: text("currency", { enum: FX_CURRENCIES }).notNull(),
    date: date("date", { mode: "string" }).notNull(),
    rate: numeric("rate", { precision: 20, scale: 8 }).notNull(),
    source: text("source").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.currency, t.date] })],
);

export const marketStockEvents = pgTable(
  "market_stock_events",
  {
    ticker: text("ticker").notNull(),
    comDate: date("com_date", { mode: "string" }).notNull(),
    factor: quantity("factor").notNull(),
    note: text("note").notNull(),
    source: text("source").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ticker, t.comDate, t.note] })],
);

/** Situação de cada ticker consultado, sem dizer quem o tem. */
export const marketTickers = pgTable("market_tickers", {
  ticker: text("ticker").primaryKey(),
  status: text("status", { enum: MARKET_TICKER_STATUSES }).notNull(),
  checkedAt: ts("checked_at").notNull().defaultNow(),
  retryOn: date("retry_on", { mode: "string" }),
  dividendsRetryOn: date("dividends_retry_on", { mode: "string" }),
  errorCode: text("error_code"),
});

/** Chamadas à cota da brapi por dia, somando rodadas e reinícios do worker. */
export const marketUsage = pgTable("market_usage", {
  day: date("day", { mode: "string" }).primaryKey(),
  calls: integer("calls").notNull().default(0),
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
    messageKey: text("message_key"),
    messageParams: jsonb("message_params").$type<Record<string, unknown>>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.kind, t.period),
    index("household_reports_recent_idx").on(t.householdId, t.createdAt),
  ],
);

/**
 * Relatórios da família, um por tipo e período (ADR-0021). Dado derivado: só o agente `relatorios`
 * grava. Valores e chaves, nunca frase: a tela escreve no idioma de quem lê. `household_reports` é
 * outra coisa: o que cada agente fez no dia. Ver migrations/0034_relatorios_da_familia.sql.
 */
export const householdStatements = pgTable(
  "household_statements",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: STATEMENT_KINDS }).notNull(),
    /** `AAAA-MM` ou, no anual, `AAAA`. */
    period: text("period").notNull(),
    status: text("status", { enum: STATEMENT_STATUSES }).notNull().default("parcial"),
    data: jsonb("data").$type<StatementData>().notNull(),
    messageKey: text("message_key"),
    messageParams: jsonb("message_params").$type<Record<string, unknown>>(),
    /** Assinatura do que a família lançou no período: é assim que o mês fechado sabe que mudou. */
    sourceHash: text("source_hash"),
    /** Parágrafo escrito com IA, só com aceite, no idioma de `whatChangedLocale`. */
    whatChanged: text("what_changed"),
    whatChangedLocale: text("what_changed_locale"),
    /** A chamada ao modelo já aconteceu: no máximo uma por relatório. */
    narratedAt: ts("narrated_at"),
    generatedAt: ts("generated_at").notNull().defaultNow(),
    closedAt: ts("closed_at"),
    /** "Atualizado em": a família lançou algo depois de o mês fechar. */
    revisedAt: ts("revised_at"),
  },
  (t) => [unique().on(t.householdId, t.id), unique().on(t.householdId, t.kind, t.period)],
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
    planNoteKey: text("plan_note_key"),
    planNoteParams: jsonb("plan_note_params").$type<Record<string, unknown>>(),
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
    messageKey: text("message_key"),
    messageParams: jsonb("message_params").$type<Record<string, unknown>>(),
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

/** Tipos conhecidos. O banco confere só o formato: acrescentar outro não pede migração. */
export const NOTIFICATION_KINDS = [
  "categoria",
  "assinatura_falhou",
  "assinatura_renovacao",
  "vip_vencendo",
  "aviso_painel",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * O que o assistente fez e a família precisa ver. A tela monta o texto a partir de `data`, em cada
 * idioma; `title` e `body` são a mesma coisa em português. `read_at` vale para a família inteira.
 * Ver migrations/0031_notificacoes.sql.
 */
export const householdNotifications = pgTable(
  "household_notifications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: NOTIFICATION_KINDS }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    messageKey: text("message_key"),
    messageParams: jsonb("message_params").$type<Record<string, unknown>>(),
    href: text("href"),
    suggestionId: text("suggestion_id"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: ts("read_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    unique().on(t.householdId, t.dedupeKey),
    index("household_notifications_recent_idx").on(t.householdId, t.createdAt),
    index("household_notifications_unread_idx")
      .on(t.householdId)
      .where(sql`read_at IS NULL`),
    foreignKey({
      columns: [t.householdId, t.suggestionId],
      foreignColumns: [householdSuggestions.householdId, householdSuggestions.id],
    }).onDelete("set null"),
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

/**
 * Lugar que a família quer conhecer (migração 0039; ADR-0026). Dado informado: o agente lê e nunca
 * muda. Destino do catálogo, ou nome livre com região. `fulfilledAt` só nasce do aceite da família.
 * Sem coluna de intenção em outra tabela: quem lê tolera a tabela ainda não existir.
 */
export const tripIntentions = pgTable(
  "trip_intentions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    destinationId: text("destination_id").references(() => tripDestinationTemplates.id),
    customName: text("custom_name"),
    customRegion: text("custom_region", { enum: DESTINATION_REGIONS }),
    /** Mês do ano (1 a 12), sem ano. */
    preferredMonth: smallint("preferred_month"),
    days: smallint("days"),
    fulfilledAt: ts("fulfilled_at"),
    fulfilledTripId: text("fulfilled_trip_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    index("trip_intentions_household_id_idx").on(t.householdId),
    // Na migração é SET NULL só de fulfilled_trip_id, para não apagar household_id.
    foreignKey({
      columns: [t.householdId, t.fulfilledTripId],
      foreignColumns: [trips.householdId, trips.id],
    }),
  ],
);
