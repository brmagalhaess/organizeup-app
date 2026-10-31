// Acesso administrativo (ou_admin, BYPASSRLS). Somente para rotinas de plataforma
// explicitamente revisadas (CODEOWNERS). Toda chamada exige um motivo, que é logado.
//
// O painel do serviço (/admin) usa só os helpers `admin*` abaixo, que rodam no pool SOMENTE
// LEITURA (`default_transaction_read_only = on`) e devolvem o mínimo: contagens e, por família,
// nome, datas e número de membros. O e-mail do responsável só sai por `adminHouseholdOwnerEmail`,
// que registra o acesso em ops.admin_access.
import { and, desc, eq, gte, ilike, inArray, lt, sql } from "drizzle-orm";
import { adminPool, adminReadPool, type Db } from "./client";
import { recordAdminAccess } from "./ops";
import { household, householdMember, householdSettings, session, user } from "./schema";

function logAccess(reason: string) {
  if (reason.trim().length < 5) {
    throw new Error("withAdmin exige um motivo descritivo.");
  }
  console.warn(JSON.stringify({ level: "warn", msg: "admin_db_access", reason }));
}

/** Acesso cross-household com escrita (seed, rotinas de plataforma). */
export async function withAdmin<T>(reason: string, fn: (db: Db) => Promise<T>): Promise<T> {
  logAccess(reason);
  return fn(adminPool().db);
}

/** Acesso cross-household SOMENTE LEITURA: qualquer escrita é recusada pelo banco. */
export async function withAdminRead<T>(reason: string, fn: (db: Db) => Promise<T>): Promise<T> {
  logAccess(reason);
  return fn(adminReadPool().db);
}

export interface AdminHouseholdRow {
  id: string;
  name: string;
  createdAt: Date;
  members: number;
  lastSessionAt: Date | null;
  onboardingVersion: number;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Lista famílias para o painel do serviço, sem nome nem e-mail de pessoas. `q` busca por nome da
 * família (contém, sem caixa) ou por e-mail exato de um membro (devolve só aquela família).
 */
export async function adminHouseholdList(input: {
  limit?: number | undefined;
  offset?: number | undefined;
  q?: string | undefined;
}): Promise<AdminHouseholdRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const q = input.q?.trim() ?? "";
  return withAdminRead("painel admin: famílias", async (db) => {
    const filter = !q
      ? undefined
      : q.includes("@")
        ? inArray(
            household.id,
            db
              .select({ id: householdMember.organizationId })
              .from(householdMember)
              .innerJoin(user, eq(user.id, householdMember.userId))
              .where(eq(user.email, q.toLowerCase())),
          )
        : ilike(household.name, `%${escapeLike(q)}%`);
    const rows = await db
      .select({
        id: household.id,
        name: household.name,
        createdAt: household.createdAt,
        members: sql<number>`count(distinct ${householdMember.userId})::int`,
        lastSessionAt: sql<Date | null>`max(${session.updatedAt})`,
        onboardingVersion: sql<number>`coalesce(${householdSettings.onboardingVersion}, 0)::int`,
      })
      .from(household)
      .leftJoin(householdMember, eq(householdMember.organizationId, household.id))
      .leftJoin(session, eq(session.userId, householdMember.userId))
      .leftJoin(householdSettings, eq(householdSettings.householdId, household.id))
      .where(filter)
      .groupBy(
        household.id,
        household.name,
        household.createdAt,
        householdSettings.onboardingVersion,
      )
      .orderBy(desc(household.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map((row) => ({
      ...row,
      lastSessionAt: row.lastSessionAt ? new Date(row.lastSessionAt) : null,
    }));
  });
}

/**
 * E-mail do responsável (owner) de UMA família. Ação explícita: fica registrada em
 * ops.admin_access com o id de quem pediu. Null se a família não existe ou não tem owner.
 */
export async function adminHouseholdOwnerEmail(
  householdId: string,
  admin: { adminUserId: string },
): Promise<string | null> {
  await recordAdminAccess({
    adminUserId: admin.adminUserId,
    action: "familia:email_responsavel",
    targetHouseholdId: householdId,
  });
  return withAdminRead("painel admin: e-mail do responsável", async (db) => {
    const [row] = await db
      .select({ email: user.email })
      .from(householdMember)
      .innerJoin(user, eq(user.id, householdMember.userId))
      .where(
        and(eq(householdMember.organizationId, householdId), eq(householdMember.role, "owner")),
      )
      .orderBy(householdMember.createdAt)
      .limit(1);
    return row?.email ?? null;
  });
}

export interface AdminOverviewCounts {
  households: number;
  users: number;
  newHouseholds7d: number;
  newHouseholds30d: number;
  /** Famílias cujo cadastro complementar está abaixo de `onboardingVersion` (ou sem settings). */
  onboardingPending: number;
}

/** Contagens do painel do serviço. Nada identifica uma família. */
export async function adminOverviewCounts(input: {
  onboardingVersion: number;
}): Promise<AdminOverviewCounts> {
  const day = 24 * 60 * 60 * 1000;
  const since7 = new Date(Date.now() - 7 * day);
  const since30 = new Date(Date.now() - 30 * day);
  return withAdminRead("painel admin: contagens", async (db) => {
    const count = sql<number>`count(*)::int`;
    const [[households], [users], [new7], [new30], [pending]] = await Promise.all([
      db.select({ n: count }).from(household),
      db.select({ n: count }).from(user),
      db.select({ n: count }).from(household).where(gte(household.createdAt, since7)),
      db.select({ n: count }).from(household).where(gte(household.createdAt, since30)),
      db
        .select({ n: count })
        .from(household)
        .leftJoin(householdSettings, eq(householdSettings.householdId, household.id))
        .where(
          sql`${householdSettings.onboardingVersion} is null or ${lt(
            householdSettings.onboardingVersion,
            input.onboardingVersion,
          )}`,
        ),
    ]);
    return {
      households: households?.n ?? 0,
      users: users?.n ?? 0,
      newHouseholds7d: new7?.n ?? 0,
      newHouseholds30d: new30?.n ?? 0,
      onboardingPending: pending?.n ?? 0,
    };
  });
}
