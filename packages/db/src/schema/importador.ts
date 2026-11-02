// Importador inteligente (ADR-0030). Migração 0042. `payload` e `fields` são rascunho até a família aprovar.
import {
  boolean,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import {
  SMART_DESTINATIONS,
  SMART_DUPLICATE_STATES,
  type SmartField,
  type SmartPayload,
} from "@organizeup/domain";
import { household, user } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const bytes = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
});

export const SMART_IMPORT_STATUSES = [
  "enviando",
  "na_fila",
  "lendo",
  "revisao",
  "concluido",
] as const;
export type SmartImportStatus = (typeof SMART_IMPORT_STATUSES)[number];
export const SMART_FILE_STATUSES = ["na_fila", "lendo", "lido", "falhou"] as const;
export type SmartFileStatus = (typeof SMART_FILE_STATUSES)[number];
export const SMART_ITEM_STATUSES = ["proposto", "gravado", "falhou"] as const;
export type SmartItemStatus = (typeof SMART_ITEM_STATUSES)[number];
const CONFIDENCES = ["alta", "media", "baixa"] as const;
const METHODS = ["regras", "modelo"] as const;

export const smartImports = pgTable(
  "smart_imports",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    status: text("status", { enum: SMART_IMPORT_STATUSES }).notNull().default("enviando"),
    useAi: boolean("use_ai").notNull().default(false),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    queuedAt: ts("queued_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    index("smart_imports_recent_idx").on(t.householdId, t.createdAt),
  ],
);

export const smartImportFiles = pgTable(
  "smart_import_files",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    importId: text("import_id").notNull(),
    position: smallint("position").notNull(),
    fileName: text("file_name").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    content: bytes("content").notNull(),
    sha256: text("sha256").notNull(),
    status: text("status", { enum: SMART_FILE_STATUSES }).notNull().default("na_fila"),
    docType: text("doc_type"),
    issuer: text("issuer"),
    confidence: text("confidence", { enum: CONFIDENCES }),
    method: text("method", { enum: METHODS }),
    failure: text("failure"),
    readAttempts: smallint("read_attempts").notNull().default(0),
    reviewed: boolean("reviewed").notNull().default(false),
    truncated: boolean("truncated").notNull().default(false),
    fields: jsonb("fields").$type<SmartField[]>().notNull().default([]),
    notes: jsonb("notes").$type<string[]>().notNull().default([]),
    accountId: text("account_id"),
    cardId: text("card_id"),
    attachedAt: ts("attached_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    unique().on(t.householdId, t.importId, t.sha256),
    unique().on(t.householdId, t.importId, t.position),
    index("smart_import_files_sha_idx").on(t.householdId, t.sha256),
    foreignKey({
      columns: [t.householdId, t.importId],
      foreignColumns: [smartImports.householdId, smartImports.id],
    }).onDelete("cascade"),
  ],
);

/** Tudo de `smart_import_files`, menos o conteúdo do arquivo. É o que listagem e exportação usam. */
export const smartImportFileMeta = {
  id: smartImportFiles.id,
  householdId: smartImportFiles.householdId,
  importId: smartImportFiles.importId,
  position: smartImportFiles.position,
  fileName: smartImportFiles.fileName,
  mediaType: smartImportFiles.mediaType,
  sizeBytes: smartImportFiles.sizeBytes,
  sha256: smartImportFiles.sha256,
  status: smartImportFiles.status,
  docType: smartImportFiles.docType,
  issuer: smartImportFiles.issuer,
  confidence: smartImportFiles.confidence,
  method: smartImportFiles.method,
  failure: smartImportFiles.failure,
  readAttempts: smartImportFiles.readAttempts,
  reviewed: smartImportFiles.reviewed,
  truncated: smartImportFiles.truncated,
  fields: smartImportFiles.fields,
  notes: smartImportFiles.notes,
  accountId: smartImportFiles.accountId,
  cardId: smartImportFiles.cardId,
  attachedAt: smartImportFiles.attachedAt,
  createdAt: smartImportFiles.createdAt,
  updatedAt: smartImportFiles.updatedAt,
};

export const FILE_SCOPES = ["importador"] as const;
export type FileScope = (typeof FILE_SCOPES)[number];

/** Aceite por escopo (ADR-0030). O de dívidas é `household_file_consents`: um não abre o outro. */
export const householdFileScopes = pgTable(
  "household_file_scopes",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: FILE_SCOPES }).notNull(),
    version: text("version").notNull(),
    acceptedBy: text("accepted_by").references(() => user.id, { onDelete: "set null" }),
    acceptedAt: ts("accepted_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.scope] })],
);

export const smartImportItems = pgTable(
  "smart_import_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    importId: text("import_id").notNull(),
    fileId: text("file_id").notNull(),
    position: integer("position").notNull(),
    destination: text("destination", { enum: SMART_DESTINATIONS }).notNull(),
    status: text("status", { enum: SMART_ITEM_STATUSES }).notNull().default("proposto"),
    selected: boolean("selected").notNull().default(false),
    duplicate: text("duplicate", { enum: SMART_DUPLICATE_STATES }).notNull().default("novo"),
    duplicateReason: text("duplicate_reason"),
    duplicateFileId: text("duplicate_file_id"),
    confidence: text("confidence", { enum: CONFIDENCES }).notNull(),
    excerpt: text("excerpt"),
    payload: jsonb("payload").$type<SmartPayload>().notNull(),
    failure: text("failure"),
    resultTable: text("result_table"),
    resultId: text("result_id"),
    approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: ts("approved_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.householdId, t.id),
    unique().on(t.householdId, t.fileId, t.position),
    index("smart_import_items_import_idx").on(t.householdId, t.importId),
    foreignKey({
      columns: [t.householdId, t.importId],
      foreignColumns: [smartImports.householdId, smartImports.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.householdId, t.fileId],
      foreignColumns: [smartImportFiles.householdId, smartImportFiles.id],
    }).onDelete("cascade"),
  ],
);
