import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { fromSession, type TenantContext } from "@organizeup/db";
import { getAuth } from "./auth";

export async function getSession() {
  return getAuth().api.getSession({ headers: await headers() });
}

/** Exige usuário autenticado; redireciona para /entrar caso contrário. */
export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/entrar");
  return session;
}

/**
 * Exige usuário autenticado COM household ativo e filiação válida.
 * Devolve a sessão e o TenantContext para usar com withHousehold().
 */
export async function requireTenant(): Promise<{
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>;
  ctx: TenantContext;
}> {
  const session = await requireSession();
  const ctx = await fromSession(session);
  if (!ctx) redirect("/app/escolher");
  return { session, ctx };
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
