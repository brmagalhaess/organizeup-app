import {
  databaseStatus,
  findAgentMemories,
  listDeployments,
  listReports,
  listWorkerHeartbeats,
} from "@organizeup/db";
import { isAuthorizedOpsRequest } from "@/lib/ops-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/context?agent=sre&q=fila → o que um agente deve ler ao acordar: situação da
 * produção, relatórios recentes e memórias, as dele e as da equipe. Sem dados pessoais.
 */
export async function GET(request: Request) {
  if (!isAuthorizedOpsRequest(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const agent = params.get("agent") ?? undefined;
  const query = params.get("q") ?? undefined;
  const [database, deployments, workers, reports, own, team] = await Promise.all([
    databaseStatus(),
    listDeployments(5),
    listWorkerHeartbeats(),
    listReports({ limit: 5 }),
    agent ? findAgentMemories({ agent, query }) : Promise.resolve([]),
    findAgentMemories({ query, limit: 10 }),
  ]);
  return Response.json(
    {
      production: { commit: process.env.APP_COMMIT ?? "dev", database, deployments, workers },
      reports,
      memories: { own, team },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
