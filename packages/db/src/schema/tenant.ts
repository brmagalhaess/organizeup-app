// Tabelas de domínio (tenant = household). Todas com RLS — ver migrations/0002_tenant.sql.
import {
  bigint,
  boolean,
  char,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { household, user } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const PERSON_RELATIONS = ["titular", "conjuge", "filho", "pai_mae", "outro"] as const;
export type PersonRelation = (typeof PERSON_RELATIONS)[number];

/** Situação de trabalho da pessoa (cadastro complementar; ADR-0016). */
export const WORK_STATUSES = [
  "clt",
  "pj_autonomo",
  "servidor",
  "aposentado",
  "estudante",
  "sem_renda",
  "outro",
] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const people = pgTable(
  "people",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    relation: text("relation", { enum: PERSON_RELATIONS }).notNull(),
    birthMonth: smallint("birth_month"),
    birthYear: smallint("birth_year"),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    irDependent: boolean("ir_dependent").notNull().default(false),
    workStatus: text("work_status", { enum: WORK_STATUSES }),
    inssContributor: boolean("inss_contributor"),
    /** Benefício mensal esperado (INSS ou previdência). Null = não informado. */
    expectedPension: numeric("expected_pension", { precision: 14, scale: 2 }),
    retirementAge: smallint("retirement_age"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.householdId, t.id), index("people_household_id_idx").on(t.householdId)],
);

export const householdSettings = pgTable(
  "household_settings",
  {
    householdId: text("household_id")
      .primaryKey()
      .references(() => household.id, { onDelete: "cascade" }),
    timezone: text("timezone").notNull().default("America/Sao_Paulo"),
    currency: text("currency").notNull().default("BRL"),
    city: text("city"),
    state: char("state", { length: 2 }),
    country: char("country", { length: 2 }).notNull().default("BR"),
    primaryPersonId: text("primary_person_id"),
    // Cadastro complementar (ADR-0016). Null = a família ainda não informou.
    retirementYear: smallint("retirement_year"),
    tripsPerYear: smallint("trips_per_year").notNull().default(0),
    tripDays: smallint("trip_days"),
    weddingDay: smallint("wedding_day"),
    weddingMonth: smallint("wedding_month"),
    weddingYear: smallint("wedding_year"),
    /**
     * Evento anual "Aniversário de casamento", criado pela família. FK composta para
     * calendar_events com SET NULL só desta coluna — definida apenas na migração, porque
     * finance.ts já importa este arquivo (import circular).
     */
    weddingEventId: text("wedding_event_id"),
    onboardingVersion: smallint("onboarding_version").notNull().default(0),
    onboardingCompletedAt: ts("onboarding_completed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.householdId, t.primaryPersonId],
      foreignColumns: [people.householdId, people.id],
    }),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id"),
    actorKind: text("actor_kind", { enum: ["user", "system", "admin"] }).notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_log_household_created_idx").on(t.householdId, t.createdAt)],
);
