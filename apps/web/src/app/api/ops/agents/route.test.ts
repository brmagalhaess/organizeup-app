import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ hasAgentRunToday: vi.fn(), readPlatformFlags: vi.fn() }));
const fila = vi.hoisted(() => ({
  DICAS_AGENT: "dicas",
  MERCADO_AGENT: "mercado",
  queueAgent: vi.fn(),
}));
vi.mock("@organizeup/db", () => db);
vi.mock("@/app/admin/fila", () => fila);

const { POST } = await import("./route");

const TOKEN = "t".repeat(40);
const url = "https://site.example.com/api/ops/agents";
const post = (payload: unknown, token = TOKEN) =>
  POST(
    new Request(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }),
  );

beforeEach(() => {
  process.env.OPS_TOKEN_HASHES = createHash("sha256").update(TOKEN).digest("hex");
  vi.clearAllMocks();
  db.readPlatformFlags.mockResolvedValue({ maintenance: false, disabledAgents: [] });
  db.hasAgentRunToday.mockResolvedValue(false);
  fila.queueAgent.mockResolvedValue("job");
});

describe("POST /api/ops/agents", () => {
  it("recusa sem token", async () => {
    expect((await post({ agent: "metas" }, "x".repeat(40))).status).toBe(401);
    expect(fila.queueAgent).not.toHaveBeenCalled();
  });

  it("recusa agente que não existe", async () => {
    expect((await post({ agent: "outro" })).status).toBe(400);
  });

  it("acorda um agente", async () => {
    const response = await post({ agent: "metas" });
    expect(await response.json()).toMatchObject({ queued: true, agent: "metas" });
    expect(fila.queueAgent).toHaveBeenCalledWith("metas");
  });

  it("o nome antigo do agente de IA continua aceito", async () => {
    const response = await post({ agent: "categorias_ia" });
    expect(await response.json()).toMatchObject({ queued: true, agent: "categorias-ia" });
    expect(fila.queueAgent).toHaveBeenCalledWith("categorias-ia");
  });

  it("respeita a manutenção e o interruptor do painel", async () => {
    db.readPlatformFlags.mockResolvedValue({ maintenance: true, disabledAgents: [] });
    expect(await (await post({ agent: "metas" })).json()).toMatchObject({ reason: "manutencao" });
    db.readPlatformFlags.mockResolvedValue({ maintenance: false, disabledAgents: ["metas"] });
    expect(await (await post({ agent: "metas" })).json()).toMatchObject({ reason: "desligado" });
    expect(fila.queueAgent).not.toHaveBeenCalled();
  });

  it("não gasta cota de mercado de novo no mesmo dia", async () => {
    db.hasAgentRunToday.mockResolvedValue(true);
    const response = await post({ agent: "mercado" });
    expect(await response.json()).toMatchObject({ queued: false, reason: "ja_rodou" });
    expect(fila.queueAgent).not.toHaveBeenCalled();
  });
});
