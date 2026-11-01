// Conversa em tempo real. Devolve eventos, um JSON por linha. Consentimento, papel e teto são
// conferidos em runChatTurn, antes de cada chamada ao modelo. A chave nunca sai do servidor.
import { createModelClient, runChatTurn, type AssistantEvent } from "@organizeup/ai";
import { z } from "zod";
import { sameSite } from "@/lib/same-site";
import { requireTenant } from "@/lib/session";

export const dynamic = "force-dynamic";

const body = z.strictObject({
  message: z.string().trim().min(1).max(2000),
  threadId: z.uuid().nullish(),
});

export async function POST(request: Request) {
  if (!sameSite(request)) return new Response(null, { status: 403 });
  const { ctx } = await requireTenant();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });

  const stop = new AbortController();
  request.signal.addEventListener("abort", () => stop.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AssistantEvent) => {
        // Quem fechou a tela não recebe mais nada, mas a resposta ainda é gravada.
        if (stop.signal.aborted) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      await runChatTurn({
        ctx,
        client: createModelClient(),
        message: parsed.data.message,
        threadId: parsed.data.threadId,
        signal: stop.signal,
        emit,
      });
      if (!stop.signal.aborted) controller.close();
    },
    cancel() {
      stop.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
