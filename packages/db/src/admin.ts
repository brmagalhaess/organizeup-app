// Acesso administrativo (ou_admin, BYPASSRLS). Somente para rotinas de plataforma
// explicitamente revisadas (CODEOWNERS). Toda chamada exige um motivo, que é logado.
//
// O painel do serviço (/admin) usa só os helpers `admin*` abaixo. Leitura vai pelo pool SOMENTE
// LEITURA (`default_transaction_read_only = on`) e devolve o mínimo: contagens e, por família, nome,
// datas, papéis e módulos usados (sim ou não). Nome e e-mail só saem por `adminHouseholdOwner` e
// `adminRevealUser`, que registram o acesso. Ação com efeito passa por `adminAct`: a mudança e o
// registro em ops.admin_access ficam na mesma transação. Nada aqui lê valores nem lançamentos.
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { adminPool, adminReadPool, type Db } from "./client";
import { FLAG_KEYS, tolerateSchemaLag } from "./access";
import { recordAdminAccess } from "./ops";
import { householdModuleUsage, type ModuleUsage } from "./platform";
import {
  adminAccess,
  aiUsage,
  auditLog,
  featureFlags,
  household,
  householdAccess,
  householdInsights,
  householdInvitation,
  householdMember,
  householdMemories,
  householdSettings,
  session,
  user,
  userAccess,
  type AiAutonomy,
} from "./schema";

function logAccess(reason: string) {
  if (reason.trim().length < 5) {
    throw new Error("withAdmin exige um motivo descritivo.");
  }
  console.warn(JSON.stringify({ level: "warn", msg: "admin_db_access", reason }));
}

/** Acesso cross-household com escrita (seed, rotinas de plataforma, ações do painel). */
export async function withAdmin<T>(reason: string, fn: (db: Db) => Promise<T>): Promise<T> {
  logAccess(reason);
  return fn(adminPool().db);
}

/** Acesso cross-household SOMENTE LEITURA: qualquer escrita é recusada pelo banco. */
export async function withAdminRead<T>(reason: string, fn: (db: Db) => Promise<T>): Promise<T> {
  logAccess(reason);
  return fn(adminReadPool().db);
}

export interface AdminActor {
  adminUserId: string;
}

type AdminTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

interface AdminEntry {
  action: string;
  targetHouseholdId?: string | undefined;
  targetUserId?: string | undefined;
}

/** Ação do painel: a mudança e o registro entram juntos, ou nenhum dos dois. */
function adminAct<T>(
  admin: AdminActor,
  entry: AdminEntry,
  fn: (tx: AdminTx) => Promise<T>,
): Promise<T> {
  return withAdmin(`painel admin: ${entry.action}`, (db) =>
    db.transaction(async (tx) => {
      await tx.insert(adminAccess).values({
        adminUserId: admin.adminUserId,
        action: entry.action,
        targetHouseholdId: entry.targetHouseholdId ?? null,
        targetUserId: entry.targetUserId ?? null,
      });
      return fn(tx);
    }),
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);
const clamp = (value: number | undefined, fallback: number, max: number) =>
  Math.min(Math.max(value ?? fallback, 1), max);
const toDate = (value: Date | string | null | undefined) => (value ? new Date(value) : null);

// ---------- Famílias ----------

export interface AdminHouseholdRow {
  id: string;
  name: string;
  createdAt: Date;
  members: number;
  lastSessionAt: Date | null;
  onboardingVersion: number;
  suspendedAt: Date | null;
}

export type HouseholdStatusFilter = "todas" | "ativas" | "suspensas";
export type OnboardingFilter = "todos" | "completo" | "pendente";
export type ActivityFilter = "todas" | "recentes" | "paradas";

/**
 * Lista famílias para o painel do serviço, sem nome nem e-mail de pessoas. `q` busca por nome da
 * família (contém, sem caixa) ou por e-mail exato de um membro (devolve só aquela família).
 */
export async function adminHouseholdList(input: {
  limit?: number | undefined;
  offset?: number | undefined;
  q?: string | undefined;
  status?: HouseholdStatusFilter | undefined;
  onboarding?: OnboardingFilter | undefined;
  onboardingVersion?: number | undefined;
  activity?: ActivityFilter | undefined;
}): Promise<AdminHouseholdRow[]> {
  const limit = clamp(input.limit, 50, 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const q = input.q?.trim() ?? "";
  const version = input.onboardingVersion ?? 1;
  const since30 = new Date(Date.now() - 30 * DAY_MS);
  return withAdminRead("painel admin: famílias", async (db) => {
    const search = !q
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
    const status =
      input.status === "suspensas"
        ? isNotNull(householdAccess.suspendedAt)
        : input.status === "ativas"
          ? isNull(householdAccess.suspendedAt)
          : undefined;
    const pendingOnboarding = sql`coalesce(${householdSettings.onboardingVersion}, 0) < ${version}`;
    const onboarding =
      input.onboarding === "pendente"
        ? pendingOnboarding
        : input.onboarding === "completo"
          ? sql`not (${pendingOnboarding})`
          : undefined;
    const lastSession = sql`max(${session.updatedAt})`;
    const activity: SQL | undefined =
      input.activity === "recentes"
        ? sql`${lastSession} >= ${since30}`
        : input.activity === "paradas"
          ? sql`coalesce(${lastSession} < ${since30}, true)`
          : undefined;
    const rows = await db
      .select({
        id: household.id,
        name: household.name,
        createdAt: household.createdAt,
        suspendedAt: householdAccess.suspendedAt,
        members: sql<number>`count(distinct ${householdMember.userId})::int`,
        lastSessionAt: sql<Date | null>`${lastSession}`,
        onboardingVersion: sql<number>`coalesce(${householdSettings.onboardingVersion}, 0)::int`,
      })
      .from(household)
      .leftJoin(householdMember, eq(householdMember.organizationId, household.id))
      .leftJoin(session, eq(session.userId, householdMember.userId))
      .leftJoin(householdSettings, eq(householdSettings.householdId, household.id))
      .where(and(search, status, onboarding))
      .groupBy(
        household.id,
        household.name,
        household.createdAt,
        householdAccess.suspendedAt,
        householdSettings.onboardingVersion,
      )
      .having(activity)
      .orderBy(desc(household.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map((row) => ({
      ...row,
      lastSessionAt: toDate(row.lastSessionAt),
      suspendedAt: toDate(row.suspendedAt),
    }));
  });
}

export interface AdminHouseholdMember {
  userId: string;
  role: string;
  joinedAt: Date;
  lastAccessAt: Date | null;
  blockedAt: Date | null;
}

export interface AdminHouseholdDetail {
  id: string;
  name: string;
  createdAt: Date;
  suspendedAt: Date | null;
  onboardingVersion: number;
  onboardingCompletedAt: Date | null;
  lastActivityAt: Date | null;
  pendingInvites: number;
  members: AdminHouseholdMember[];
  modules: ModuleUsage;
}

/** Detalhe de UMA família: papéis, datas e módulos (sim ou não). Sem nome de pessoa nem valores. */
export async function adminHouseholdDetail(id: string): Promise<AdminHouseholdDetail | null> {
  return withAdminRead("painel admin: detalhe da família", async (db) => {
    const [row] = await db
      .select({
        id: household.id,
        name: household.name,
        createdAt: household.createdAt,
        suspendedAt: householdAccess.suspendedAt,
        onboardingVersion: sql<number>`coalesce(${householdSettings.onboardingVersion}, 0)::int`,
        onboardingCompletedAt: householdSettings.onboardingCompletedAt,
      })
      .from(household)
      .leftJoin(householdSettings, eq(householdSettings.householdId, household.id))
      .where(eq(household.id, id));
    if (!row) return null;
    const [members, [invites], [audit], modules] = await Promise.all([
      db
        .select({
          userId: householdMember.userId,
          role: householdMember.role,
          joinedAt: householdMember.createdAt,
          blockedAt: userAccess.blockedAt,
          lastAccessAt: sql<Date | null>`(select max(s.updated_at) from "session" s
            where s.user_id = ${householdMember.userId})`,
        })
        .from(householdMember)
        .innerJoin(user, eq(user.id, householdMember.userId))
        .where(eq(householdMember.organizationId, id))
        .orderBy(householdMember.createdAt),
      db
        .select({ n: count() })
        .from(householdInvitation)
        .where(
          and(
            eq(householdInvitation.organizationId, id),
            eq(householdInvitation.status, "pending"),
          ),
        ),
      db
        .select({ at: sql<Date | null>`max(${auditLog.createdAt})` })
        .from(auditLog)
        .where(eq(auditLog.householdId, id)),
      householdModuleUsage(db, id),
    ]);
    const memberRows = members.map((member) => ({
      ...member,
      lastAccessAt: toDate(member.lastAccessAt),
      blockedAt: toDate(member.blockedAt),
    }));
    const moments = [
      ...memberRows.flatMap((member) => (member.lastAccessAt ? [member.lastAccessAt] : [])),
      ...(audit?.at ? [new Date(audit.at)] : []),
    ];
    return {
      ...row,
      suspendedAt: toDate(row.suspendedAt),
      lastActivityAt: moments.length
        ? new Date(Math.max(...moments.map((moment) => moment.getTime())))
        : null,
      pendingInvites: invites?.n ?? 0,
      members: memberRows,
      modules,
    };
  });
}

export interface AdminHouseholdAssistant {
  /** Null: o assistente está desligado nesta família. */
  consentAt: Date | null;
  autonomy: AiAutonomy;
  activeInsights: number;
  memories: number;
  /** Mesma conta do limite diário por família: leitura de cache fica fora. */
  monthTokens: number;
}

/**
 * Situação do assistente em UMA família, só com data, nível e contagens: nenhuma coluna de texto da
 * família é lida. Null enquanto a migração não chegou.
 */
export function adminHouseholdAssistant(
  id: string,
  today: string,
): Promise<AdminHouseholdAssistant | null> {
  const monthStart = `${today.slice(0, 7)}-01`;
  return tolerateSchemaLag(
    () =>
      withAdminRead("painel admin: assistente da família", async (db) => {
        const [[settings], [insights], [memories], [usage]] = await Promise.all([
          db
            .select({
              consentAt: householdSettings.aiConsentAt,
              autonomy: householdSettings.aiAutonomy,
            })
            .from(householdSettings)
            .where(eq(householdSettings.householdId, id)),
          db
            .select({ n: count() })
            .from(householdInsights)
            .where(
              and(
                eq(householdInsights.householdId, id),
                eq(householdInsights.status, "ativa"),
                gte(householdInsights.expiresOn, today),
              ),
            ),
          db
            .select({ n: count() })
            .from(householdMemories)
            .where(
              and(eq(householdMemories.householdId, id), isNull(householdMemories.supersededBy)),
            ),
          db
            .select({
              tokens: sql<string>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens} + ${aiUsage.cacheWriteTokens}), 0)::text`,
            })
            .from(aiUsage)
            .where(and(eq(aiUsage.householdId, id), gte(aiUsage.day, monthStart))),
        ]);
        return {
          consentAt: toDate(settings?.consentAt),
          autonomy: settings?.autonomy ?? "organizar",
          activeInsights: insights?.n ?? 0,
          memories: memories?.n ?? 0,
          monthTokens: Number(usage?.tokens ?? 0),
        };
      }),
    null,
  );
}

/**
 * Nome e e-mail do responsável (owner) de UMA família. Ação explícita: fica registrada em
 * ops.admin_access com o id de quem pediu. Null se a família não existe ou não tem owner.
 */
export async function adminHouseholdOwner(
  householdId: string,
  admin: AdminActor,
): Promise<{ name: string; email: string } | null> {
  await recordAdminAccess({
    adminUserId: admin.adminUserId,
    action: "familia:email_responsavel",
    targetHouseholdId: householdId,
  });
  return withAdminRead("painel admin: contato do responsável", async (db) => {
    const [row] = await db
      .select({ name: user.name, email: user.email })
      .from(householdMember)
      .innerJoin(user, eq(user.id, householdMember.userId))
      .where(
        and(eq(householdMember.organizationId, householdId), eq(householdMember.role, "owner")),
      )
      .orderBy(householdMember.createdAt)
      .limit(1);
    return row ?? null;
  });
}

const isMemberOf = async (tx: AdminTx, userId: string, householdId: string) => {
  const [row] = await tx
    .select({ id: householdMember.id })
    .from(householdMember)
    .where(and(eq(householdMember.userId, userId), eq(householdMember.organizationId, householdId)))
    .limit(1);
  return Boolean(row);
};

export type HouseholdActionResult = "ok" | "not_found" | "own_family";

/**
 * Suspende ou reativa uma família. Suspender encerra as sessões dos membros, para o bloqueio valer
 * já; quem participa de outra família só precisa entrar de novo.
 */
export async function adminSetHouseholdSuspended(
  admin: AdminActor,
  householdId: string,
  suspended: boolean,
): Promise<HouseholdActionResult> {
  const action = suspended ? "familia:suspender" : "familia:reativar";
  return adminAct(admin, { action, targetHouseholdId: householdId }, async (tx) => {
    if (suspended && (await isMemberOf(tx, admin.adminUserId, householdId))) return "own_family";
    const updated = await tx
      .update(householdAccess)
      .set({ suspendedAt: suspended ? new Date() : null })
      .where(eq(householdAccess.id, householdId))
      .returning({ id: householdAccess.id });
    if (updated.length === 0) return "not_found";
    if (suspended) {
      await tx
        .delete(session)
        .where(
          inArray(
            session.userId,
            tx
              .select({ id: householdMember.userId })
              .from(householdMember)
              .where(eq(householdMember.organizationId, householdId)),
          ),
        );
    }
    return "ok";
  });
}

/**
 * Exclui a família e, em cascata, tudo dela: o mesmo DELETE de "apagar a família" e da exclusão de
 * conta. `typedName` precisa ser o nome exato; a tela pede, e o servidor confere de novo.
 */
export async function adminDeleteHousehold(
  admin: AdminActor,
  householdId: string,
  typedName: string,
): Promise<HouseholdActionResult | "name_mismatch"> {
  const entry = { action: "familia:excluir", targetHouseholdId: householdId };
  return adminAct(admin, entry, async (tx) => {
    const [row] = await tx
      .select({ name: household.name })
      .from(household)
      .where(eq(household.id, householdId));
    if (!row) return "not_found";
    if (row.name !== typedName.trim()) return "name_mismatch";
    if (await isMemberOf(tx, admin.adminUserId, householdId)) return "own_family";
    await tx.delete(household).where(eq(household.id, householdId));
    return "ok";
  });
}

// ---------- Usuários ----------

export interface AdminUserRow {
  id: string;
  createdAt: Date;
  emailVerified: boolean;
  blockedAt: Date | null;
  lastAccessAt: Date | null;
  households: number;
  isOwner: boolean;
}

export type UserStatusFilter = "todos" | "bloqueados" | "nao_verificados" | "sem_familia";

/**
 * Lista contas sem nome nem e-mail. `q` é o e-mail exato ou o id da conta, nunca parte deles: o
 * painel não serve para garimpar pessoas.
 */
export async function adminUserList(input: {
  limit?: number | undefined;
  offset?: number | undefined;
  q?: string | undefined;
  status?: UserStatusFilter | undefined;
}): Promise<AdminUserRow[]> {
  const limit = clamp(input.limit, 50, 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const q = input.q?.trim() ?? "";
  return withAdminRead("painel admin: usuários", async (db) => {
    const search = !q
      ? undefined
      : q.includes("@")
        ? eq(user.email, q.toLowerCase())
        : eq(user.id, q);
    const status =
      input.status === "bloqueados"
        ? isNotNull(userAccess.blockedAt)
        : input.status === "nao_verificados"
          ? eq(user.emailVerified, false)
          : undefined;
    const families = sql`count(distinct ${householdMember.organizationId})`;
    const rows = await db
      .select({
        id: user.id,
        createdAt: user.createdAt,
        emailVerified: user.emailVerified,
        blockedAt: userAccess.blockedAt,
        lastAccessAt: sql<Date | null>`max(${session.updatedAt})`,
        households: sql<number>`${families}::int`,
        isOwner: sql<boolean>`coalesce(bool_or(${householdMember.role} = 'owner'), false)`,
      })
      .from(user)
      .leftJoin(householdMember, eq(householdMember.userId, user.id))
      .leftJoin(session, eq(session.userId, user.id))
      .where(and(search, status))
      .groupBy(user.id, user.createdAt, user.emailVerified, userAccess.blockedAt)
      .having(input.status === "sem_familia" ? sql`${families} = 0` : undefined)
      .orderBy(desc(user.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map((row) => ({
      ...row,
      blockedAt: toDate(row.blockedAt),
      lastAccessAt: toDate(row.lastAccessAt),
    }));
  });
}

export interface AdminUserDetail {
  id: string;
  createdAt: Date;
  emailVerified: boolean;
  blockedAt: Date | null;
  lastAccessAt: Date | null;
  activeSessions: number;
  families: Array<{ id: string; name: string; role: string; suspendedAt: Date | null }>;
  /** Nome e e-mail só podem ser revelados de responsável ou de conta sem família. */
  canReveal: boolean;
}

export async function adminUserDetail(id: string): Promise<AdminUserDetail | null> {
  return withAdminRead("painel admin: detalhe do usuário", async (db) => {
    const [row] = await db
      .select({
        id: user.id,
        createdAt: user.createdAt,
        emailVerified: user.emailVerified,
        blockedAt: userAccess.blockedAt,
      })
      .from(user)
      .where(eq(user.id, id));
    if (!row) return null;
    const [[sessions], families] = await Promise.all([
      db
        .select({
          lastAccessAt: sql<Date | null>`max(${session.updatedAt})`,
          active: sql<number>`count(*) filter (where ${session.expiresAt} > now())::int`,
        })
        .from(session)
        .where(eq(session.userId, id)),
      db
        .select({
          id: household.id,
          name: household.name,
          role: householdMember.role,
          suspendedAt: householdAccess.suspendedAt,
        })
        .from(householdMember)
        .innerJoin(household, eq(household.id, householdMember.organizationId))
        .where(eq(householdMember.userId, id))
        .orderBy(household.createdAt),
    ]);
    return {
      ...row,
      blockedAt: toDate(row.blockedAt),
      lastAccessAt: toDate(sessions?.lastAccessAt),
      activeSessions: sessions?.active ?? 0,
      families: families.map((family) => ({
        ...family,
        suspendedAt: toDate(family.suspendedAt),
      })),
      canReveal: families.length === 0 || families.some((family) => family.role === "owner"),
    };
  });
}

/** Nome e e-mail de uma conta, por ação registrada. Membro comum não é revelado (regra 5). */
export async function adminRevealUser(
  admin: AdminActor,
  userId: string,
): Promise<{ name: string; email: string } | "not_found" | "not_allowed"> {
  const entry = { action: "usuario:revelar", targetUserId: userId };
  return adminAct(admin, entry, async (tx) => {
    const [row] = await tx
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, userId));
    if (!row) return "not_found";
    const roles = await tx
      .select({ role: householdMember.role })
      .from(householdMember)
      .where(eq(householdMember.userId, userId));
    const allowed = roles.length === 0 || roles.some(({ role }) => role === "owner");
    return allowed ? row : "not_allowed";
  });
}

export type UserActionResult = "ok" | "not_found" | "self";

/** Encerra todas as sessões da conta. Sem sessões, o resultado é o mesmo. */
export async function adminEndUserSessions(
  admin: AdminActor,
  userId: string,
): Promise<UserActionResult> {
  const entry = { action: "usuario:encerrar_sessoes", targetUserId: userId };
  return adminAct(admin, entry, async (tx) => {
    if (userId === admin.adminUserId) return "self";
    const [row] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId));
    if (!row) return "not_found";
    await tx.delete(session).where(eq(session.userId, userId));
    return "ok";
  });
}

/** Bloqueia (e encerra as sessões) ou desbloqueia uma conta. */
export async function adminSetUserBlocked(
  admin: AdminActor,
  userId: string,
  blocked: boolean,
): Promise<UserActionResult> {
  const action = blocked ? "usuario:bloquear" : "usuario:desbloquear";
  return adminAct(admin, { action, targetUserId: userId }, async (tx) => {
    if (blocked && userId === admin.adminUserId) return "self";
    const updated = await tx
      .update(userAccess)
      .set({ blockedAt: blocked ? new Date() : null })
      .where(eq(userAccess.id, userId))
      .returning({ id: userAccess.id });
    if (updated.length === 0) return "not_found";
    if (blocked) await tx.delete(session).where(eq(session.userId, userId));
    return "ok";
  });
}

/** E-mail para o pedido de redefinição de senha. Não vai para a tela; o pedido fica registrado. */
export async function adminPasswordResetTarget(
  admin: AdminActor,
  userId: string,
): Promise<string | null> {
  const entry = { action: "usuario:redefinir_senha", targetUserId: userId };
  return adminAct(admin, entry, async (tx) => {
    const [row] = await tx.select({ email: user.email }).from(user).where(eq(user.id, userId));
    return row?.email ?? null;
  });
}

/**
 * Exclui a conta com a mesma regra de "apagar minha conta": famílias só da pessoa somem junto; família
 * com mais gente impede, para ninguém perder o acesso sem aviso.
 */
export async function adminDeleteUser(
  admin: AdminActor,
  userId: string,
): Promise<UserActionResult | "family_has_members"> {
  const entry = { action: "usuario:excluir", targetUserId: userId };
  return adminAct(admin, entry, async (tx) => {
    if (userId === admin.adminUserId) return "self";
    const [row] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId));
    if (!row) return "not_found";
    const owned = await tx
      .select({ id: householdMember.organizationId })
      .from(householdMember)
      .where(and(eq(householdMember.userId, userId), eq(householdMember.role, "owner")));
    const ids = owned.map((family) => family.id);
    if (ids.length > 0) {
      const [other] = await tx
        .select({ id: householdMember.id })
        .from(householdMember)
        .where(
          and(inArray(householdMember.organizationId, ids), ne(householdMember.userId, userId)),
        )
        .limit(1);
      if (other) return "family_has_members";
      await tx.delete(household).where(inArray(household.id, ids));
    }
    await tx.delete(user).where(eq(user.id, userId));
    return "ok";
  });
}

// ---------- Chaves do sistema ----------

/** Registro de uma ação cujo efeito acontece fora do banco, como enfileirar uma rodada. */
export async function adminRecordAction(admin: AdminActor, action: string): Promise<void> {
  await adminAct(admin, { action }, async () => {});
}

/** Liga ou desliga uma chave. `action` é o registro da auditoria, curto e fixo. */
export async function adminSetFlag(
  admin: AdminActor,
  input: {
    key: string;
    enabled: boolean;
    value?: Record<string, unknown> | undefined;
    action: string;
  },
): Promise<void> {
  const value = input.value ?? {};
  await adminAct(admin, { action: input.action }, async (tx) => {
    await tx
      .insert(featureFlags)
      .values({
        key: input.key,
        enabled: input.enabled,
        value,
        updatedBy: admin.adminUserId,
      })
      .onConflictDoUpdate({
        target: featureFlags.key,
        set: {
          enabled: input.enabled,
          value,
          updatedBy: admin.adminUserId,
          updatedAt: new Date(),
        },
      });
  });
}

export async function adminRemoveNotice(admin: AdminActor, id: string): Promise<void> {
  await adminAct(admin, { action: "controle:aviso_remover" }, async (tx) => {
    await tx.delete(featureFlags).where(eq(featureFlags.key, FLAG_KEYS.notice(id)));
  });
}

// ---------- Auditoria ----------

export interface AdminAccessRow {
  id: number;
  at: Date;
  adminUserId: string;
  action: string;
  targetHouseholdId: string | null;
  targetUserId: string | null;
}

export async function adminAccessList(input: {
  limit?: number | undefined;
  offset?: number | undefined;
  /** Só estas ações. */
  actions?: string[] | undefined;
  /** Todas menos estas. */
  excludeActions?: string[] | undefined;
  sinceDays?: number | undefined;
  /** Id exato da família ou da conta. */
  target?: string | undefined;
}): Promise<AdminAccessRow[]> {
  const limit = clamp(input.limit, 50, 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const target = input.target?.trim();
  return withAdminRead("painel admin: auditoria", (db) =>
    db
      .select()
      .from(adminAccess)
      .where(
        and(
          input.actions ? inArray(adminAccess.action, input.actions) : undefined,
          input.excludeActions ? notInArray(adminAccess.action, input.excludeActions) : undefined,
          input.sinceDays
            ? gte(adminAccess.at, new Date(Date.now() - input.sinceDays * DAY_MS))
            : undefined,
          target
            ? or(eq(adminAccess.targetHouseholdId, target), eq(adminAccess.targetUserId, target))
            : undefined,
        ),
      )
      .orderBy(desc(adminAccess.at), desc(adminAccess.id))
      .limit(limit)
      .offset(offset),
  );
}

// ---------- Visão geral ----------

export interface AdminOverviewCounts {
  households: number;
  users: number;
  newHouseholds7d: number;
  newHouseholds30d: number;
  /** Famílias cujo cadastro complementar está abaixo de `onboardingVersion` (ou sem settings). */
  onboardingPending: number;
  /** Famílias com alguma sessão atualizada nos últimos 30 dias. */
  active30d: number;
  suspended: number;
  blocked: number;
}

/** Contagens do painel do serviço. Nada identifica uma família. */
export async function adminOverviewCounts(input: {
  onboardingVersion: number;
}): Promise<AdminOverviewCounts> {
  const since7 = new Date(Date.now() - 7 * DAY_MS);
  const since30 = new Date(Date.now() - 30 * DAY_MS);
  return withAdminRead("painel admin: contagens", async (db) => {
    const counted = sql<number>`count(*)::int`;
    const [[households], [users], [new7], [new30], [pending], [active], [suspended], [blocked]] =
      await Promise.all([
        db.select({ n: counted }).from(household),
        db.select({ n: counted }).from(user),
        db.select({ n: counted }).from(household).where(gte(household.createdAt, since7)),
        db.select({ n: counted }).from(household).where(gte(household.createdAt, since30)),
        db
          .select({ n: counted })
          .from(household)
          .leftJoin(householdSettings, eq(householdSettings.householdId, household.id))
          .where(
            sql`${householdSettings.onboardingVersion} is null or ${lt(
              householdSettings.onboardingVersion,
              input.onboardingVersion,
            )}`,
          ),
        db
          .select({ n: countDistinct(householdMember.organizationId) })
          .from(householdMember)
          .innerJoin(session, eq(session.userId, householdMember.userId))
          .where(gte(session.updatedAt, since30)),
        db
          .select({ n: counted })
          .from(householdAccess)
          .where(isNotNull(householdAccess.suspendedAt)),
        db.select({ n: counted }).from(userAccess).where(isNotNull(userAccess.blockedAt)),
      ]);
    return {
      households: households?.n ?? 0,
      users: users?.n ?? 0,
      newHouseholds7d: new7?.n ?? 0,
      newHouseholds30d: new30?.n ?? 0,
      onboardingPending: pending?.n ?? 0,
      active30d: active?.n ?? 0,
      suspended: suspended?.n ?? 0,
      blocked: blocked?.n ?? 0,
    };
  });
}

export interface AdminAssistantCounts {
  assistantOn: number;
  /** Famílias cujo aceite já cita a rotina da madrugada. */
  insightsOn: number;
  withMemories: number;
}

/** Quantas famílias usam o assistente. Só contagens, nada identifica uma família. */
export function adminAssistantCounts(input: {
  insightsConsentVersion: string;
}): Promise<AdminAssistantCounts> {
  const { insightsConsentVersion } = input;
  return tolerateSchemaLag(
    () =>
      withAdminRead("painel admin: adoção do assistente", async (db) => {
        const consented = sql`${householdSettings.aiConsentAt} is not null`;
        // Mesma ordem da comparação de strings do portão das dicas, sem depender do idioma do banco.
        const current = sql`${householdSettings.aiConsentVersion} collate "C" >= ${insightsConsentVersion}`;
        const [[settings], [memories]] = await Promise.all([
          db
            .select({
              assistantOn: sql<number>`count(*) filter (where ${consented})::int`,
              insightsOn: sql<number>`count(*) filter (where ${consented} and ${current})::int`,
            })
            .from(householdSettings),
          db
            .select({ n: countDistinct(householdMemories.householdId) })
            .from(householdMemories)
            .where(isNull(householdMemories.supersededBy)),
        ]);
        return {
          assistantOn: settings?.assistantOn ?? 0,
          insightsOn: settings?.insightsOn ?? 0,
          withMemories: memories?.n ?? 0,
        };
      }),
    { assistantOn: 0, insightsOn: 0, withMemories: 0 },
  );
}

export interface AdminGrowthWeek {
  /** Segunda-feira da semana (`YYYY-MM-DD`, horário de Brasília). */
  week: string;
  households: number;
  users: number;
  newHouseholds: number;
  newUsers: number;
}

/** Totais acumulados por semana, só com as datas de criação. Nada de dado de família. */
export async function adminGrowth(weeks = 12): Promise<AdminGrowthWeek[]> {
  const span = clamp(weeks, 12, 52) - 1;
  return withAdminRead("painel admin: crescimento", async (db) => {
    const rows = await db.execute<{
      week: string;
      households: number;
      users: number;
      new_households: number;
      new_users: number;
    }>(sql`
      with local_now as (select (now() at time zone 'America/Sao_Paulo') as t),
      series as (
        select generate_series(
          date_trunc('week', (select t from local_now)) - make_interval(weeks => ${span}),
          date_trunc('week', (select t from local_now)),
          interval '1 week'
        ) as week
      )
      select
        to_char(s.week, 'YYYY-MM-DD') as week,
        (select count(*)::int from household h
          where (h.created_at at time zone 'America/Sao_Paulo') < s.week + interval '1 week') as households,
        (select count(*)::int from "user" u
          where (u.created_at at time zone 'America/Sao_Paulo') < s.week + interval '1 week') as users,
        (select count(*)::int from household h
          where date_trunc('week', h.created_at at time zone 'America/Sao_Paulo') = s.week) as new_households,
        (select count(*)::int from "user" u
          where date_trunc('week', u.created_at at time zone 'America/Sao_Paulo') = s.week) as new_users
      from series s
      order by s.week`);
    return rows.map((row) => ({
      week: row.week,
      households: row.households,
      users: row.users,
      newHouseholds: row.new_households,
      newUsers: row.new_users,
    }));
  });
}

/** Migrações aplicadas, da mais nova para a mais antiga. */
export async function adminMigrations(): Promise<Array<{ version: string; appliedAt: Date }>> {
  return withAdminRead("painel admin: migrações", async (db) => {
    const rows = await db.execute<{ version: string; applied_at: Date | string }>(
      sql`select version, applied_at from public.schema_migrations order by version desc`,
    );
    return rows.map((row) => ({ version: row.version, appliedAt: new Date(row.applied_at) }));
  });
}
