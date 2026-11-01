import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isAuthorizedOpsRequest } from "@/lib/ops-auth";
import { createOpsMcpServer } from "@/lib/ops-mcp";

export const dynamic = "force-dynamic";

const unauthorized = () =>
  Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );

/**
 * MCP da equipe (Streamable HTTP, sem estado): sem sessão, cada POST cria o próprio servidor e o
 * próprio transporte, e a resposta vem em JSON. Mesmo token da Ops API.
 */
export async function POST(request: Request) {
  if (!isAuthorizedOpsRequest(request.headers.get("authorization"))) return unauthorized();
  const server = createOpsMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

/** Sem sessão não há fluxo de notificações para abrir (GET) nem para encerrar (DELETE). */
function notAllowed(request: Request) {
  if (!isAuthorizedOpsRequest(request.headers.get("authorization"))) return unauthorized();
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export { notAllowed as GET, notAllowed as DELETE };
