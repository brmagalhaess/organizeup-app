import { describe, expect, it, vi } from "vitest";

vi.mock("@organizeup/db", () => ({ hasAgentRunToday: vi.fn() }));
vi.mock("@organizeup/agents", () => ({
  APOSENTADORIA_AGENT: "aposentadoria",
  CATEGORIAS_AGENT: "categorias",
  DIVIDAS_AGENT: "dividas",
  INVESTIMENTOS_AGENT: "investimentos",
  METAS_AGENT: "metas",
  VIAGENS_AGENT: "viagens",
}));
vi.mock("./diagnostics", () => ({ reportAgentFailure: vi.fn() }));

const { agentsToRun, DAILY_AGENTS } = await import("./daily-agents");

const day = "2026-11-01";
const never = async () => false;

describe("ordem da rodada", () => {
  it("dívidas roda antes da aposentadoria, que usa a dívida cara", () => {
    expect(DAILY_AGENTS.indexOf("dividas")).toBeLessThan(DAILY_AGENTS.indexOf("aposentadoria"));
  });
});

describe("quem roda", () => {
  it("sem pedido, todos os ligados", async () => {
    expect(await agentsToRun({}, ["viagens"], day, never)).toEqual(
      DAILY_AGENTS.filter((agent) => agent !== "viagens"),
    );
  });

  it("o Paperclip acorda um agente só", async () => {
    expect(await agentsToRun({ agents: ["metas"] }, [], day, never)).toEqual(["metas"]);
  });

  it("agente desligado no painel não roda nem acordado", async () => {
    expect(await agentsToRun({ agents: ["metas"] }, ["metas"], day, never)).toEqual([]);
  });

  it("a rede de segurança pega só quem faltou", async () => {
    const ran = async (_: string, agent: string) => agent !== "metas";
    expect(await agentsToRun({ missingOnly: true }, [], day, ran)).toEqual(["metas"]);
  });
});
