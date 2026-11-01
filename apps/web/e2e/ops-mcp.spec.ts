// Cliente MCP real do SDK contra o servidor no ar. Precisa de E2E_OPS_TOKEN, com o SHA-256 dele em
// OPS_TOKEN_HASHES no servidor.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test } from "@playwright/test";

const token = process.env.E2E_OPS_TOKEN ?? "";

test.skip(!token, "Defina E2E_OPS_TOKEN e suba o servidor com o hash dele em OPS_TOKEN_HASHES.");

async function connect(baseURL: string, bearer: string) {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("/api/mcp/ops", baseURL), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  await client.connect(transport);
  return client;
}

type ToolResult = { isError?: boolean; content: Array<{ text: string }> };

test("equipe usa as ferramentas pelo MCP", async ({ baseURL }) => {
  const client = await connect(baseURL!, token);
  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<ToolResult>;

  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name)).toContain("marcar_erro_resolvido");

  const context = await call("contexto_producao", { agent: "sre" });
  expect(context.isError).toBeFalsy();
  const parsed = JSON.parse(context.content[0]!.text) as Record<string, unknown>;
  expect(parsed).toHaveProperty("production");
  expect(parsed).toHaveProperty("diagnostics");
  expect(parsed).toHaveProperty("errorRates");

  // Sem o horário em milissegundos: 13 dígitos seguidos a barreira trata como cartão.
  const lesson = `Lição do teste ${Math.random().toString(36).slice(2, 10)}.`;
  const saved = await call("salvar_memoria", { agent: "sre", kind: "licao", content: lesson });
  expect(saved.isError).toBeFalsy();
  const found = await call("buscar_memoria", { agent: "sre" });
  expect(found.content[0]!.text).toContain(lesson);

  const refused = await call("salvar_memoria", {
    agent: "sre",
    kind: "fato",
    content: "Falar com ana.silva@gmail.com",
  });
  expect(refused.isError).toBe(true);
  await client.close();
});

test("token errado não conecta", async ({ baseURL }) => {
  await expect(connect(baseURL!, "x".repeat(40))).rejects.toThrow();
});
