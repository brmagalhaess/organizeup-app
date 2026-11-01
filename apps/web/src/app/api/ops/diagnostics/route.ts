import { resolveDiagnostic } from "@organizeup/db";
import { isAuthorizedOpsRequest } from "@/lib/ops-auth";
import { parseBody } from "@/lib/ops-content";
import { diagnosticFiltersSchema, loadDiagnostics, resolveDiagnosticSchema } from "@/lib/ops-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/diagnostics?status=aberto&service=web&commit=abc&route=/app/metas&limit=50
 * → erros por impressão digital e a taxa de cada versão. Sem mensagem nem dado de família.
 */
export async function GET(request: Request) {
  if (!isAuthorizedOpsRequest(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const filters = diagnosticFiltersSchema.safeParse(Object.fromEntries(params));
  if (!filters.success) return Response.json({ error: "Filtro inválido." }, { status: 422 });
  const result = await loadDiagnostics(filters.data);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

/** POST /api/ops/diagnostics `{fingerprint}` → marca resolvido em todas as versões. */
export async function POST(request: Request) {
  if (!isAuthorizedOpsRequest(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await parseBody(request, resolveDiagnosticSchema);
  if ("error" in body) return body.error;
  const resolved = await resolveDiagnostic(body.data.fingerprint);
  return Response.json({ resolved });
}
