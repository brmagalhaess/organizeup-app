// Contexto de tenant e o ÚNICO caminho para ler/gravar tabelas de domínio.
// Ver docs/adr/0002-isolamento-e-auth.md.
import { and, eq, sql } from "drizzle-orm";
import { appPool, type Db } from "./client";
import { household, householdMember } from "./schema";

export const HOUSEHOLD_ROLES = ["owner", "adult", "child", "viewer"] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];
export type TenantRole = HouseholdRole | "system";

const BRAND: unique symbol = Symbol("organizeup.TenantContext");
const issued = new WeakSet<object>();

export interface TenantContext {
  readonly [BRAND]: true;
  readonly householdId: string;
  readonly userId: string | null;
  readonly role: TenantRole;
}

/** Transação já com o contexto do household aplicado (RLS ativa). */
export type TenantTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function issue(householdId: string, userId: string | null, role: TenantRole): TenantContext {
  const ctx = Object.freeze({ [BRAND]: true as const, householdId, userId, role });
  issued.add(ctx);
  return ctx;
}

function isHouseholdRole(role: string): role is HouseholdRole {
  return (HOUSEHOLD_ROLES as readonly string[]).includes(role);
}

/** Formato mínimo da sessão do Better Auth de que precisamos. */
export interface SessionLike {
  user: { id: string };
  session: { activeOrganizationId?: string | null | undefined };
}

/**
 * Constrói o contexto a partir da sessão autenticada, validando que o usuário é
 * membro ativo do household ativo. Retorna null se não houver household ativo/válido.
 */
export async function fromSession(
  session: SessionLike | null | undefined,
): Promise<TenantContext | null> {
  const householdId = session?.session.activeOrganizationId;
  const userId = session?.user.id;
  if (!householdId || !userId) return null;
  const membership = await getMembership(userId, householdId);
  if (!membership) return null;
  return issue(householdId, userId, membership.role);
}

/**
 * Contexto para jobs do worker. As políticas só aceitam o papel 'system' quando a
 * conexão é do role ou_worker, então chamar isto na web não concede escrita.
 */
export function fromJob(job: { householdId: string }): TenantContext {
  if (!job.householdId) throw new Error("Job sem householdId.");
  return issue(job.householdId, null, "system");
}

export async function getMembership(
  userId: string,
  householdId: string,
): Promise<{ role: HouseholdRole } | null> {
  const rows = await appPool()
    .db.select({ role: householdMember.role })
    .from(householdMember)
    .where(and(eq(householdMember.userId, userId), eq(householdMember.organizationId, householdId)))
    .limit(1);
  const role = rows[0]?.role;
  return role && isHouseholdRole(role) ? { role } : null;
}

/** Households de que o usuário participa (para escolher o ativo). */
export async function listMemberships(userId: string) {
  return appPool()
    .db.select({ householdId: household.id, name: household.name, role: householdMember.role })
    .from(householdMember)
    .innerJoin(household, eq(household.id, householdMember.organizationId))
    .where(eq(householdMember.userId, userId))
    .orderBy(household.createdAt);
}

/**
 * Executa `fn` numa transação CURTA com o household aplicado via set_config(..., true).
 * Nunca chame LLMs ou APIs externas dentro de `fn` (segura uma conexão do pool).
 */
export async function withHousehold<T>(
  ctx: TenantContext,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!issued.has(ctx)) {
    throw new Error("TenantContext inválido: use fromSession() ou fromJob().");
  }
  return appPool().db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.household_id', ${ctx.householdId}, true),
                 set_config('app.user_id', ${ctx.userId ?? ""}, true),
                 set_config('app.role', ${ctx.role}, true)`,
    );
    return fn(tx);
  });
}

/** Atalho para jobs do worker. */
export function withWorkerHousehold<T>(
  householdId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return withHousehold(fromJob({ householdId }), fn);
}

/** Papéis que podem alterar dados do household. */
export function canWrite(ctx: TenantContext): boolean {
  return ctx.role === "owner" || ctx.role === "adult" || ctx.role === "system";
}
