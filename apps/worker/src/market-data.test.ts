import { beforeEach, describe, expect, it, vi } from "vitest";

const readPlatformFlags = vi.fn();
const runMarketData = vi.fn();
vi.mock("@organizeup/db", () => ({ readPlatformFlags }));
vi.mock("@organizeup/agents", () => ({
  DEFAULT_MAX_CALLS_PER_DAY: 400,
  MERCADO_AGENT: "mercado",
  runMarketData,
}));
vi.mock("./daily-agents", () => ({ ACTIVE_DAYS: 60 }));

const { runMarketDataJob } = await import("./market-data");

const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
const flags = { maintenance: false, disabledAgents: [] as string[] };

describe("job de mercado", () => {
  beforeEach(() => runMarketData.mockReset());

  it("roda com o interruptor ligado", async () => {
    readPlatformFlags.mockResolvedValue(flags);
    await runMarketDataJob(log);
    expect(runMarketData).toHaveBeenCalledOnce();
  });

  it("respeita o interruptor do painel", async () => {
    readPlatformFlags.mockResolvedValue({ ...flags, disabledAgents: ["mercado"] });
    await runMarketDataJob(log);
    expect(runMarketData).not.toHaveBeenCalled();
  });

  it("para no modo manutenção, como os outros agentes", async () => {
    readPlatformFlags.mockResolvedValue({ ...flags, maintenance: true });
    await runMarketDataJob(log);
    expect(runMarketData).not.toHaveBeenCalled();
  });
});
