import { listDeployments, listWorkerHeartbeats } from "@organizeup/db";
import { isAuthorizedOpsRequest } from "@/lib/ops-auth";

export const dynamic = "force-dynamic";

/**
 * Ops API (agentes do Paperclip). Sem PII.
 * GET /api/ops/deployments?limit=20 → últimos boots de web/worker com o commit rodando.
 */
export async function GET(request: Request) {
  if (!isAuthorizedOpsRequest(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  const [deployments, workers] = await Promise.all([
    listDeployments(Number.isFinite(limit) ? limit : 20),
    listWorkerHeartbeats(),
  ]);
  return Response.json(
    {
      current: { web: process.env.APP_COMMIT ?? "dev" },
      deployments,
      workers,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
