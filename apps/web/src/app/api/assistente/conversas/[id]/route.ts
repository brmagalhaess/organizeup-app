import { deleteThread, loadThread } from "@organizeup/ai";
import { z } from "zod";
import { sameSite } from "@/lib/same-site";
import { requireTenant } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const threadId = z.uuid();

export async function GET(_request: Request, { params }: Params) {
  const { ctx } = await requireTenant();
  const id = threadId.safeParse((await params).id);
  if (!id.success) return new Response(null, { status: 404 });
  const messages = await loadThread(ctx, id.data);
  return messages ? Response.json({ messages }) : new Response(null, { status: 404 });
}

export async function DELETE(request: Request, { params }: Params) {
  if (!sameSite(request)) return new Response(null, { status: 403 });
  const { ctx } = await requireTenant();
  const id = threadId.safeParse((await params).id);
  if (!id.success) return new Response(null, { status: 404 });
  return new Response(null, { status: (await deleteThread(ctx, id.data)) ? 204 : 404 });
}
