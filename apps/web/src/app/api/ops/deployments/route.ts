import { isAuthorizedOpsRequest } from "@/lib/ops-auth";
import { loadOpsDeployments } from "@/lib/ops-data";

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
  const deployments = await loadOpsDeployments(Number.isFinite(limit) ? limit : 20);
  return Response.json(deployments, { headers: { "Cache-Control": "no-store" } });
}
