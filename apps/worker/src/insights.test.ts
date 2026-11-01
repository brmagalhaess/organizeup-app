import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  fromJob: vi.fn((input: object) => input),
  hasAgentRunToday: vi.fn(),
  listActiveHouseholdIds: vi.fn(),
  readPlatformFlags: vi.fn(),
  recordAgentDiscards: vi.fn(),
  recordAgentRun: vi.fn(),
};
const runNightlyInsights = vi.fn();
vi.mock("@organizeup/db", () => db);
vi.mock("@organizeup/ai", () => ({
  assistantConfigured: () => true,
  createModelClient: () => ({}),
  runNightlyInsights,
}));
vi.mock("./daily-agents", () => ({ ACTIVE_DAYS: 60 }));
vi.mock("./diagnostics", () => ({ reportAgentFailure: vi.fn() }));

const { INSIGHTS_AGENT, runInsightsJob } = await import("./insights");

const log = { error: vi.fn(), info: vi.fn() };
const ready = { gate: "pronto", created: 2, discarded: 1, specialists: 2 };

describe("job de dicas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.readPlatformFlags.mockResolvedValue({
      maintenance: false,
      aiEnabled: true,
      disabledAgents: [],
    });
    db.listActiveHouseholdIds.mockResolvedValue(["a", "b"]);
    db.hasAgentRunToday.mockResolvedValue(false);
  });

  it("grava as dicas e os descartes do verificador por agente", async () => {
    runNightlyInsights.mockResolvedValue(ready);
    await runInsightsJob(log);
    expect(db.recordAgentDiscards).toHaveBeenCalledWith(expect.any(String), INSIGHTS_AGENT, 2);
    expect(db.recordAgentRun).toHaveBeenCalledWith(
      expect.any(String),
      INSIGHTS_AGENT,
      expect.objectContaining({ households: 2, ok: 2, suggestions: 4 }),
    );
  });

  it("sem descarte, não grava linha à toa", async () => {
    runNightlyInsights.mockResolvedValue({ ...ready, discarded: 0 });
    await runInsightsJob(log);
    expect(db.recordAgentDiscards).not.toHaveBeenCalled();
  });

  it("pedir de novo no dia não zera a rodada da madrugada", async () => {
    runNightlyInsights.mockResolvedValue({ ...ready, gate: "ja_rodou" });
    db.hasAgentRunToday.mockResolvedValue(true);
    await runInsightsJob(log);
    expect(db.recordAgentRun).not.toHaveBeenCalled();
  });

  it("sem ninguém para atender, a rodada do dia fica registrada", async () => {
    runNightlyInsights.mockResolvedValue({ ...ready, gate: "sem_aceite" });
    await runInsightsJob(log);
    expect(db.recordAgentRun).toHaveBeenCalledOnce();
  });
});
