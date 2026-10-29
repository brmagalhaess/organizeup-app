import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
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
