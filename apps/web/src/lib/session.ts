import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import {
  fromSession,
  householdIsSuspended,
  readOnlyContext,
  readPlatformFlags,
  userIsBlocked,
  type TenantContext,
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
 * Devolve a sessão e o TenantContext para usar com withHousehold(). No modo manutenção o contexto
 * vem só leitura: canWrite() responde não e a RLS recusa a escrita.
 */
export async function requireTenant(): Promise<{
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
 * Exige administrador do serviço: id do usuário em ADMIN_USER_IDS (comparação exata) ou, só para
 * desenvolvimento e e2e, e-mail em ADMIN_EMAILS (sem caixa). Quem não é recebe 404: o painel não
 * revela que existe.
 */
export async function requireAdmin() {
  const session = await requireSession();
  const emails = envList(process.env.ADMIN_EMAILS).map((email) => email.toLowerCase());
  const allowed =
    envList(process.env.ADMIN_USER_IDS).includes(session.user.id) ||
    emails.includes(session.user.email.toLowerCase());
  if (!allowed) notFound();
  return session;
}
