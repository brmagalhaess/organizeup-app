import { exportHousehold, withHousehold } from "@organizeup/db";
import { audit } from "@/lib/audit";
import { identityForExport } from "@/lib/identity";
import { requireOwnData } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /app/exportar: arquivo com todos os dados da família. Só o responsável. */
export async function GET() {
  // Com o papel de verdade: o `viewer` do só leitura não vê a auditoria, e a exportação sairia menor.
  const { ctx } = await requireOwnData();
  if (ctx.role !== "owner") return new Response("Somente o responsável.", { status: 403 });
  const tables = await withHousehold(ctx, async (tx) => {
    const data = await exportHousehold(tx);
    await audit(tx, ctx, "export", "household", ctx.householdId);
    return data;
  });
  const identificacao = await identityForExport(ctx.userId ?? "");
  const exportedAt = new Date().toISOString();
  const body = JSON.stringify({ exportedAt, identificacao, tables }, null, 2);
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="organizeup-dados.json"',
      "Cache-Control": "no-store",
    },
  });
}
