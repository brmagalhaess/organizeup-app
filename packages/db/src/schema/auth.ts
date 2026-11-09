// Tabelas do Better Auth. As CHAVES TypeScript seguem os nomes de campo que o Better Auth
// espera (ex.: `organizationId`); os nomes de coluna no banco são os da migration 0001.
// Mudanças aqui exigem migration SQL nova em packages/db/migrations (ver AGENTS.md).
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** Plugin twoFactor (migração 0044, ADR-0034): com true, entrar exige o código do autenticador. */
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * Segredo TOTP e códigos de reserva de cada conta, cifrados pelo Better Auth (ADR-0034). Uma linha por
 * conta; some com ela. `verified` fica false entre pedir a ativação e confirmar o primeiro código.
 */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId), index("two_factor_secret_idx").on(t.secret)],
);

/** household = "organization" do Better Auth. */
export const household = pgTable("household", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at"),
});

/**
 * Colunas de acesso de `user` e `household` (migração 0018), de propósito fora das tabelas acima: o
 * Better Auth e o adapter leem TODAS as colunas declaradas nelas, e uma coluna nova ali derrubaria o
 * login enquanto a migração não chega. Mesmas tabelas; só `access.ts` e o painel usam estas colunas.
 */
export const userAccess = pgTable("user", {
  id: text("id").primaryKey(),
  blockedAt: ts("blocked_at"),
});

export const householdAccess = pgTable("household", {
  id: text("id").primaryKey(),
  suspendedAt: ts("suspended_at"),
  /** Tipo da conta (migração 0035): 'pf' tem família, 'pj' tem sócios. Só `access.ts` usa. */
  accountType: text("account_type").$type<"pf" | "pj">().notNull().default("pf"),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_household_id"),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const householdMember = pgTable(
  "household_member",
  {
    id: text("id").primaryKey(),
    organizationId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.organizationId, t.userId),
    index("household_member_user_id_idx").on(t.userId),
  ],
);

export const householdInvitation = pgTable(
  "household_invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    expiresAt: ts("expires_at").notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("household_invitation_household_id_idx").on(t.organizationId)],
);

/** Aceite dos Termos e da Privacidade: uma linha por versão aceita. Não faz parte do Better Auth. */
export const legalAcceptance = pgTable(
  "legal_acceptance",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    acceptedAt: ts("accepted_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.version] })],
);

/** Preferências da pessoa (idioma). Fora de `user` pelo mesmo motivo de `userAccess`. */
export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  locale: text("locale").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * Documento de quem tem conta (ADR-0022). Fora de `user` pelo mesmo motivo de `userAccess`. As colunas
 * `*_encrypted` só abrem com a chave da web, e a RLS deixa cada conta ver só a sua linha.
 */
export const userIdentity = pgTable("user_identity", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** true: mora no Brasil. false: outro país, sem documento. null: só dispensou o pedido. */
  inBrazil: boolean("in_brazil"),
  personType: text("person_type").$type<"pf" | "pj">(),
  cpfEncrypted: text("cpf_encrypted"),
  cpfHash: text("cpf_hash"),
  cnpjEncrypted: text("cnpj_encrypted"),
  cnpjHash: text("cnpj_hash"),
  companyNameEncrypted: text("company_name_encrypted"),
  dismissedAt: ts("dismissed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Mapa no formato que o adapter Drizzle do Better Auth espera (nomes de modelo padrão). */
export const betterAuthSchema = {
  user,
  session,
  account,
  verification,
  organization: household,
  member: householdMember,
  invitation: householdInvitation,
  twoFactor,
};
