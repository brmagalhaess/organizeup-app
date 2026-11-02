import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import {
  fromSession,
  householdIsSuspended,
  readFamilyAccess,
  readOnlyContext,
  readPlatformFlags,
  userIsBlocked,
  type TenantContext,
  type TenantRole,
} from "@organizeup/db";
import { getAuth } from "./auth";

/** Uma vez por requisição: o layout raiz também precisa dela, para achar o idioma da conta. */
export const getSession = cache(async () => getAuth().api.getSession({ headers: await headers() }));

/** Chaves do sistema, lidas uma vez por requisição. */
export const platformFlags = cache(readPlatformFlags);

/** Exige usuário autenticado e não bloqueado; redireciona para /entrar caso contrário. */
export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/entrar");
  if (await userIsBlocked(session.user.id)) redirect("/conta-bloqueada");
  return session;
}

/**
 * Exige usuário autenticado COM household ativo, filiação válida e família não suspensa.
 * Devolve a sessão e o TenantContext para usar com withHousehold(). No modo manutenção, e quando o
 * teste ou a assinatura acabaram, o contexto vem só leitura: canWrite() responde não e a RLS recusa a
 * escrita. `role` segue o papel de verdade no só leitura do plano, para a tela de assinar (ADR-0023).
 */
export async function requireTenant(): Promise<{
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>;
  ctx: TenantContext;
  role: TenantRole;
}> {
  const session = await requireSession();
  const ctx = await fromSession(session);
  if (!ctx) redirect("/app/escolher");
  if (await householdIsSuspended(ctx.householdId)) redirect("/app/suspensa");
  const flags = await platformFlags();
  if (flags.maintenance) {
    const paused = readOnlyContext(ctx);
    return { session, ctx: paused, role: paused.role };
  }
  const expired = (await readFamilyAccess(ctx, flags)).mode === "leitura";
  return { session, ctx: expired ? readOnlyContext(ctx) : ctx, role: ctx.role };
}

/**
 * O que é da pessoa mesmo sem plano: exportar, apagar memória e conversa, desligar o assistente. Usa o
 * papel de verdade, porque em só leitura a família continua dona dos dados (LGPD). A manutenção vale
 * igual: nela ninguém escreve.
 */
export async function requireOwnData(): Promise<{
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>;
  ctx: TenantContext;
}> {
  const session = await requireSession();
  const ctx = await fromSession(session);
  if (!ctx) redirect("/app/escolher");
  if (await householdIsSuspended(ctx.householdId)) redirect("/app/suspensa");
  const { maintenance } = await platformFlags();
  return { session, ctx: maintenance ? readOnlyContext(ctx) : ctx };
}

const envList = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * Administrador do serviço: id do usuário em ADMIN_USER_IDS (comparação exata) ou, só para
 * desenvolvimento e e2e, e-mail em ADMIN_EMAILS (sem caixa).
 */
export function isServiceAdmin(user: { id: string; email: string }): boolean {
  const emails = envList(process.env.ADMIN_EMAILS).map((email) => email.toLowerCase());
  return (
    envList(process.env.ADMIN_USER_IDS).includes(user.id) ||
    emails.includes(user.email.toLowerCase())
  );
}

/** Exige administrador do serviço. Quem não é recebe 404: o painel não revela que existe. */
export async function requireAdmin() {
  const session = await requireSession();
  if (!isServiceAdmin(session.user)) notFound();
  return session;
}
