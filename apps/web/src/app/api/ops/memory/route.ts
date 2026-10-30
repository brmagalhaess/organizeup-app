import { addAgentMemory, findAgentMemories } from "@organizeup/db";
import { isAuthorizedOpsRequest } from "@/lib/ops-auth";
import { memorySchema, parseBody } from "@/lib/ops-content";

export const dynamic = "force-dynamic";

/** GET /api/ops/memory?agent=sre&q=fila → memórias vigentes, pela busca ou as mais recentes. */
export async function GET(request: Request) {
  if (!isAuthorizedOpsRequest(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const memories = await findAgentMemories({
    agent: params.get("agent") ?? undefined,
    query: params.get("q") ?? undefined,
  });
  return Response.json({ memories }, { headers: { "Cache-Control": "no-store" } });
}

/** POST /api/ops/memory → guarda o que um agente aprendeu. Recusa dado pessoal (422). */
export async function POST(request: Request) {
  if (!isAuthorizedOpsRequest(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await parseBody(request, memorySchema);
  if ("error" in body) return body.error;
  const memory = await addAgentMemory(body.data);
  return Response.json({ memory }, { status: 201 });
}
