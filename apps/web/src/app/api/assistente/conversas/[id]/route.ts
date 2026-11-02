import { deleteThread, loadThread } from "@organizeup/ai";
import { z } from "zod";
import { sameSite } from "@/lib/same-site";
import { requireModule } from "@/lib/billing/plan-gate";
import { requireOwnData } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const threadId = z.uuid();

export async function GET(_request: Request, { params }: Params) {
  const { ctx, allowed } = await requireModule("assistente");
  if (!allowed) return new Response(null, { status: 403 });
  const id = threadId.safeParse((await params).id);
  if (!id.success) return new Response(null, { status: 404 });
  const messages = await loadThread(ctx, id.data);
  return messages ? Response.json({ messages }) : new Response(null, { status: 404 });
}

export async function DELETE(request: Request, { params }: Params) {
  if (!sameSite(request)) return new Response(null, { status: 403 });
  // Apagar a própria conversa vale sem o módulo e em só leitura.
  const { ctx } = await requireOwnData();
  const id = threadId.safeParse((await params).id);
  if (!id.success) return new Response(null, { status: 404 });
  return new Response(null, { status: (await deleteThread(ctx, id.data)) ? 204 : 404 });
}
