import { listThreads } from "@organizeup/ai";
import { requireModule } from "@/lib/billing/plan-gate";

export const dynamic = "force-dynamic";

/** Histórico de quem pediu. O RLS só deixa ver as próprias conversas. */
export async function GET() {
  const { ctx, allowed } = await requireModule("assistente");
  if (!allowed) return new Response(null, { status: 403 });
  return Response.json({ threads: await listThreads(ctx) });
}
