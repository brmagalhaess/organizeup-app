import { listReports, saveReport } from "@organizeup/db";
import { isAuthorizedOpsRequest } from "@/lib/ops-auth";
import { parseBody, reportSchema } from "@/lib/ops-content";

export const dynamic = "force-dynamic";

/** GET /api/ops/reports?kind=saude&limit=10 → relatórios mais recentes. */
export async function GET(request: Request) {
  if (!isAuthorizedOpsRequest(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const limit = Number(params.get("limit") ?? 10);
  const reports = await listReports({
    kind: params.get("kind") ?? undefined,
    limit: Number.isFinite(limit) ? limit : 10,
  });
  return Response.json({ reports }, { headers: { "Cache-Control": "no-store" } });
}

/** POST /api/ops/reports → cria, ou atualiza o relatório do mesmo tipo e período. */
export async function POST(request: Request) {
  if (!isAuthorizedOpsRequest(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await parseBody(request, reportSchema);
  if ("error" in body) return body.error;
  const report = await saveReport(body.data);
  return Response.json({ report }, { status: 201 });
}
