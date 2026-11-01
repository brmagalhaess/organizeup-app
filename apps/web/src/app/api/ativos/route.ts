// Busca no catálogo de ativos para o cadastro. Lê só a tabela global: o que a família digita não sai
// do sistema e não gasta cota da fonte.
import { searchMarketAssets } from "@organizeup/db";
import { requireTenant } from "@/lib/session";

export const dynamic = "force-dynamic";

const MIN_QUERY = 2;
const MAX_QUERY = 40;

export async function GET(request: Request) {
  await requireTenant();
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, MAX_QUERY) ?? "";
  if (query.length < MIN_QUERY) return Response.json({ assets: [] });
  return Response.json(
    { assets: await searchMarketAssets(query) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
