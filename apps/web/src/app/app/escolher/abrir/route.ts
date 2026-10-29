import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getMembership } from "@organizeup/db";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /app/escolher/abrir?id=<householdId>
 * Ativa um household do qual o usuário é membro e redireciona para /app.
 * Redirecionamentos relativos: atrás de proxy, request.url pode trazer o host interno.
 */
export async function GET(request: Request) {
  const householdId = new URL(request.url).searchParams.get("id") ?? "";
  const auth = getAuth();
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/entrar");
  if (!householdId || !(await getMembership(session.user.id, householdId))) {
    redirect("/app/escolher");
  }
  await auth.api.setActiveOrganization({
    headers: requestHeaders,
    body: { organizationId: householdId },
  });
  redirect("/app");
}
