import { listThreads } from "@organizeup/ai";
import { requireTenant } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Histórico de quem pediu. O RLS só deixa ver as próprias conversas. */
export async function GET() {
  const { ctx } = await requireTenant();
  return Response.json({ threads: await listThreads(ctx) });
}
