import { beforeEach, describe, expect, it, vi } from "vitest";

const order = vi.hoisted(() => [] as string[]);
const result = vi.hoisted(() => ({ suggestions: 0, applied: 0, report: {} }));
const step = vi.hoisted(() => (name: string, extra: object = {}) => async () => {
  order.push(name);
  return { ...result, ...extra };
});

vi.mock("@organizeup/db", () => ({
  hasAgentRunToday: vi.fn(),
  householdTimezone: vi.fn(async () => undefined),
  listActiveHouseholdIds: vi.fn(async () => ["hh-1"]),
  readPlatformFlags: vi.fn(async () => ({ maintenance: false, disabledAgents: [] })),
  recordAgentRun: vi.fn(async () => undefined),
  withWorkerHousehold: vi.fn(async (_: string, fn: (tx: object) => Promise<unknown>) => fn({})),
}));
vi.mock("@organizeup/agents", () => ({
  APOSENTADORIA_AGENT: "aposentadoria",
  CATEGORIAS_AGENT: "categorias",
  CATEGORIAS_IA_AGENT: "categorias_ia",
  DIVIDAS_AGENT: "dividas",
  INVESTIMENTOS_AGENT: "investimentos",
  METAS_AGENT: "metas",
  RELATORIOS_AGENT: "relatorios",
  VIAGENS_AGENT: "viagens",
  runCategoriasAgent: step("categorias"),
  runInvestimentosAgent: step("investimentos"),
  runAposentadoriaAgent: step("aposentadoria", { allocation: {} }),
  runViagensAgent: step("viagens"),
  runMetasAgent: step("metas"),
  runRelatoriosAgent: step("relatorios"),
}));
vi.mock("./category-review", () => ({ categoryReviewer: vi.fn() }));
vi.mock("./statement-narration", () => ({ statementNarrator: vi.fn() }));
vi.mock("./diagnostics", () => ({ reportAgentFailure: vi.fn() }));

const { recordAgentRun } = await import("@organizeup/db");
const { categoryReviewer } = await import("./category-review");
const { statementNarrator } = await import("./statement-narration");
const { agentsToRun, DAILY_AGENTS, runDailyAgents } = await import("./daily-agents");

const day = "2026-11-01";
const never = async () => false;

describe("ordem da rodada", () => {
  it("dívidas roda antes da aposentadoria, que usa a dívida cara", () => {
    expect(DAILY_AGENTS.indexOf("dividas")).toBeLessThan(DAILY_AGENTS.indexOf("aposentadoria"));
  });
});

describe("relatórios", () => {
  it("rodam depois de todos os outros", () => {
    expect(DAILY_AGENTS.at(-1)).toBe("relatorios");
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

  it("as categorias com IA rodam depois das regras e antes da aposentadoria", () => {
    const at = (agent: (typeof DAILY_AGENTS)[number]) => DAILY_AGENTS.indexOf(agent);
    expect(at("categorias_ia")).toBe(at("categorias") + 1);
    expect(at("categorias_ia")).toBeLessThan(at("aposentadoria"));
  });

  it("acordar categorias traz a etapa de IA, a menos que ela esteja desligada", async () => {
    expect(await agentsToRun({ agents: ["categorias"] }, [], day, never)).toEqual([
      "categorias",
      "categorias_ia",
    ]);
    expect(await agentsToRun({ agents: ["categorias"] }, ["categorias_ia"], day, never)).toEqual([
      "categorias",
    ]);
  });

  it("agente desligado no painel não roda nem acordado", async () => {
    expect(await agentsToRun({ agents: ["metas"] }, ["metas"], day, never)).toEqual([]);
  });

  it("a rede de segurança pega só quem faltou", async () => {
    const ran = async (_: string, agent: string) => agent !== "metas";
    expect(await agentsToRun({ missingOnly: true }, [], day, ran)).toEqual(["metas"]);
  });
});

describe("etapa de IA na rodada", () => {
  const log = { error: vi.fn(), info: vi.fn() };
  const runOf = (agent: string) =>
    vi.mocked(recordAgentRun).mock.calls.find((call) => call[1] === agent)?.[2];

  beforeEach(() => {
    order.length = 0;
    vi.clearAllMocks();
  });

  it("roda entre as regras e a aposentadoria e conta o que fez", async () => {
    vi.mocked(categoryReviewer).mockReturnValue(async () => {
      order.push("categorias_ia");
      return { moved: 7 } as never;
    });
    await runDailyAgents(log);
    expect(order.slice(0, 4)).toEqual([
      "categorias",
      "categorias_ia",
      "investimentos",
      "aposentadoria",
    ]);
    expect(runOf("categorias_ia")).toMatchObject({ ok: 1, suggestions: 0, applied: 7 });
  });

  it("falha do modelo conta como falha e o resto da rodada segue, sem texto no log", async () => {
    const secret = "descrição do extrato";
    vi.mocked(categoryReviewer).mockReturnValue(async () => {
      throw Object.assign(new Error(secret), { code: "api-500" });
    });
    await runDailyAgents(log);
    expect(order).toContain("aposentadoria");
    expect(runOf("categorias_ia")).toMatchObject({ households: 1, failed: 1 });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(secret);
    expect(log.error).toHaveBeenCalledWith(
      { householdId: "hh-1", agent: "categorias_ia", code: "api-500" },
      expect.any(String),
    );
  });

  it("o parágrafo vem depois do relatório, e a falha dele não desfaz nada", async () => {
    vi.mocked(categoryReviewer).mockReturnValue(null);
    vi.mocked(statementNarrator).mockReturnValue(async () => {
      order.push("paragrafo");
      throw Object.assign(new Error("valor da família"), { code: "api-500" });
    });
    await runDailyAgents(log);
    expect(order.slice(-2)).toEqual(["relatorios", "paragrafo"]);
    expect(runOf("relatorios")).toMatchObject({ households: 1, ok: 1, failed: 1 });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("valor da família");
  });

  it("sem aceite ou sem chave, as regras rodam sozinhas", async () => {
    vi.mocked(categoryReviewer).mockReturnValue(null);
    await runDailyAgents(log);
    expect(order).toContain("categorias");
    expect(runOf("categorias_ia")).toMatchObject({ households: 0, ok: 0 });
  });
});
