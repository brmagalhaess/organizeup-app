import { databaseStatus } from "@organizeup/db";

export const dynamic = "force-dynamic";

const startedAt = Date.now();

/**
 * GET /api/health            → checagem completa (inclui banco). Usada pelo Uptime Kuma e pelo CI.
 * GET /api/health?probe=live → só o processo. Usada pelo health check do Docker/Swarm,
 *                              para uma queda do banco não derrubar/reverter os containers.
 */
export async function GET(request: Request) {
  const commit = process.env.APP_COMMIT ?? "dev";
  const uptimeSeconds = Math.round((Date.now() - startedAt) / 1000);
  const base = { service: "web", commit, uptimeSeconds };

  if (new URL(request.url).searchParams.get("probe") === "live") {
    return Response.json({ status: "ok", ...base }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const db = await databaseStatus();
    return Response.json(
      { status: "ok", ...base, db: { ok: true, schemaVersion: db.schemaVersion } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "degraded", ...base, db: { ok: false } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
