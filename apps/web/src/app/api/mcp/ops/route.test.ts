// Cliente MCP real do SDK falando com o Route Handler: mesmo protocolo, sem abrir porta.
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fingerprint = "a".repeat(32);

const db = vi.hoisted(() => ({
  addAgentMemory: vi.fn(),
  captureError: vi.fn().mockResolvedValue(undefined),
  databaseStatus: vi.fn(),
  findAgentMemories: vi.fn(),
  listAgentRuns: vi.fn(),
  listCategorizationStats: vi.fn(),
  listDeployments: vi.fn(),
  listDiagnosticRates: vi.fn(),
  listDiagnostics: vi.fn(),
  listReports: vi.fn(),
  listWorkerHeartbeats: vi.fn(),
  resolveDiagnostic: vi.fn(),
  saveReport: vi.fn(),
}));
vi.mock("@organizeup/db", () => db);

const route = await import("./route");

const TOKEN = "t".repeat(40);
const url = new URL("https://site.example.com/api/mcp/ops");

/** `fetch` que entrega a requisição ao handler da rota, como o Next faria. */
const handler = async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  if (request.method === "POST") return route.POST(request);
  if (request.method === "GET") return route.GET(request);
  return route.DELETE(request);
};

let client: Client;

async function connect(token: string) {
  const next = new Client({ name: "teste", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: handler,
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await next.connect(transport);
  return next;
}

const call = (name: string, args: Record<string, unknown> = {}) =>
  client.callTool({ name, arguments: args }) as Promise<{
    isError?: boolean;
    content: Array<{ text: string }>;
  }>;

const parsed = async (name: string, args?: Record<string, unknown>) => {
  const result = await call(name, args);
  expect(result.isError).toBeFalsy();
  return JSON.parse(result.content[0]!.text) as Record<string, never>;
};

beforeEach(async () => {
  process.env.OPS_TOKEN_HASHES = createHash("sha256").update(TOKEN).digest("hex");
  vi.clearAllMocks();
  db.databaseStatus.mockResolvedValue({ ok: true, schemaVersion: "0020_diagnosticos" });
  db.findAgentMemories.mockResolvedValue([{ id: 1, content: "fila parou por falta de índice" }]);
  db.listAgentRuns.mockResolvedValue([]);
  db.listCategorizationStats.mockResolvedValue([]);
  db.listDeployments.mockResolvedValue([{ service: "web", commit: "abc" }]);
  db.listDiagnosticRates.mockResolvedValue([{ commit: "abc", perHour: 1 }]);
  db.listDiagnostics.mockResolvedValue([{ fingerprint, count: 2 }]);
  db.listReports.mockResolvedValue([{ id: 1, title: "Tudo certo" }]);
  db.listWorkerHeartbeats.mockResolvedValue([]);
  db.resolveDiagnostic.mockResolvedValue(1);
  db.addAgentMemory.mockImplementation(async (memory: object) => ({ id: 7, ...memory }));
  db.saveReport.mockImplementation(async (report: object) => ({ id: 8, ...report }));
  client = await connect(TOKEN);
});

afterEach(async () => {
  await client.close();
});

describe("MCP da equipe", () => {
  it("lista as ferramentas, cada uma com esquema de entrada", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "buscar_memoria",
      "contexto_producao",
      "listar_deploys",
      "listar_erros_abertos",
      "listar_relatorios",
      "marcar_erro_resolvido",
      "salvar_memoria",
      "salvar_relatorio",
    ]);
    const memory = tools.find((tool) => tool.name === "salvar_memoria")!;
    expect(memory.inputSchema.required).toEqual(
      expect.arrayContaining(["agent", "kind", "content"]),
    );
  });

  it("contexto traz produção, memórias e erros abertos", async () => {
    const context = await parsed("contexto_producao", { agent: "sre", q: "fila" });
    expect(context).toMatchObject({
      production: { database: { schemaVersion: "0020_diagnosticos" } },
      diagnostics: [{ fingerprint }],
      errorRates: [{ commit: "abc" }],
      memories: { own: [{ id: 1 }], team: [{ id: 1 }] },
    });
    expect(db.findAgentMemories).toHaveBeenCalledWith({ agent: "sre", query: "fila" });
  });

  it("deploys, relatórios e memória devolvem as leituras do banco", async () => {
    expect(await parsed("listar_deploys", { limit: 3 })).toMatchObject({
      deployments: [{ commit: "abc" }],
    });
    expect(db.listDeployments).toHaveBeenCalledWith(3);
    expect(await parsed("listar_relatorios", { kind: "saude" })).toMatchObject({
      reports: [{ title: "Tudo certo" }],
    });
    expect(db.listReports).toHaveBeenCalledWith({ kind: "saude", limit: undefined });
    expect(await parsed("buscar_memoria", { q: "índice" })).toMatchObject({
      memories: [{ id: 1 }],
    });
  });

  it("lista erros com filtros e marca resolvido", async () => {
    expect(await parsed("listar_erros_abertos", { service: "worker" })).toMatchObject({
      diagnostics: [{ fingerprint, count: 2 }],
    });
    expect(db.listDiagnostics).toHaveBeenCalledWith({ service: "worker" });
    expect(await parsed("marcar_erro_resolvido", { fingerprint })).toEqual({ resolved: 1 });
    expect(db.resolveDiagnostic).toHaveBeenCalledWith(fingerprint);
  });

  it("salva memória e relatório", async () => {
    const memory = { agent: "sre", kind: "licao", content: "Conferir o índice da fila." };
    expect(await parsed("salvar_memoria", memory)).toMatchObject({ memory: { id: 7 } });
    const report = {
      kind: "saude",
      period: "2026-10-31",
      agent: "sre",
      title: "Saúde",
      body: "Sem falhas.",
    };
    expect(await parsed("salvar_relatorio", report)).toMatchObject({ report: { id: 8 } });
  });

  it("escrita com dado pessoal é recusada pela barreira", async () => {
    const result = await call("salvar_memoria", {
      agent: "sre",
      kind: "fato",
      content: "A família de ana.silva@gmail.com reclamou.",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Parece conter e-mail");
    expect(db.addAgentMemory).not.toHaveBeenCalled();
  });

  it("resposta com dado pessoal não sai, nem pela memória antiga", async () => {
    db.findAgentMemories.mockResolvedValue([{ id: 2, content: "CPF 123.456.789-09" }]);
    const result = await call("buscar_memoria");
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe("A resposta parece conter CPF e não foi devolvida.");
  });

  it("falha do banco não mostra a mensagem dele", async () => {
    db.listReports.mockRejectedValue(new Error("Failed query: ana@example.com"));
    const result = await call("listar_relatorios");
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).not.toContain("ana@example.com");
    expect(db.captureError).toHaveBeenCalledOnce();
  });

  it("recusa token errado com 401, antes de qualquer ferramenta", async () => {
    await expect(connect("x".repeat(40))).rejects.toThrow();
    const response = await route.POST(new Request(url, { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("sem sessão, GET e DELETE não existem", async () => {
    const headers = { Authorization: `Bearer ${TOKEN}` };
    expect((await route.GET(new Request(url, { headers }))).status).toBe(405);
    expect((await route.DELETE(new Request(url, { headers }))).status).toBe(405);
    expect((await route.GET(new Request(url))).status).toBe(401);
  });

  it("clientes em sequência não dividem estado", async () => {
    const other = await connect(TOKEN);
    const [one, two] = await Promise.all([
      other.callTool({ name: "buscar_memoria", arguments: {} }),
      client.callTool({ name: "listar_deploys", arguments: {} }),
    ]);
    expect(one.isError).toBeFalsy();
    expect(two.isError).toBeFalsy();
    await other.close();
  });
});
