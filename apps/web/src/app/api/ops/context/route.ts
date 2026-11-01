import { isAuthorizedOpsRequest } from "@/lib/ops-auth";
import { loadOpsContext } from "@/lib/ops-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/context?agent=sre&q=fila → o que um agente deve ler ao acordar: situação da
 * produção, relatórios recentes, memórias e erros abertos. Sem dados pessoais.
 */
export async function GET(request: Request) {
  if (!isAuthorizedOpsRequest(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const context = await loadOpsContext({
    agent: params.get("agent") ?? undefined,
    query: params.get("q") ?? undefined,
  });
  return Response.json(context, { headers: { "Cache-Control": "no-store" } });
}
