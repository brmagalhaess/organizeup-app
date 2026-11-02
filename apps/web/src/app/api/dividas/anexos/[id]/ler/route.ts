// Lê um arquivo guardado com a IA. Aceites e teto são conferidos em readDebtDocument, antes da chamada,
// e nada aqui grava dívida: o resultado fica como rascunho até a conferência.
import { createModelClient, readDebtDocument } from "@organizeup/ai";
import { canWrite } from "@organizeup/db";
import { createRateLimiter } from "@/lib/rate-limit";
import { sameSite } from "@/lib/same-site";
import { requireModule } from "@/lib/billing/plan-gate";

export const dynamic = "force-dynamic";

const allow = createRateLimiter({ limit: 20, windowMs: 60_000 });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameSite(request)) return new Response(null, { status: 403 });
  const { ctx } = await requireModule("dividas");
  if (!canWrite(ctx)) return new Response(null, { status: 403 });
  if (!allow(ctx.householdId)) return new Response(null, { status: 429 });
  const { id } = await params;
  const result = await readDebtDocument({ ctx, client: createModelClient(), documentId: id });
  return Response.json(
    result.status === "lido"
      ? { status: "lido" }
      : result.status === "bloqueado"
        ? { status: result.status, reason: result.gate }
        : { status: result.status, reason: result.reason },
  );
}
