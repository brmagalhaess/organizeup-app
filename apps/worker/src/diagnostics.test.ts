import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ captureError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@organizeup/db", () => db);

const { reportAgentFailure, reportingFailures } = await import("./diagnostics");

beforeEach(() => vi.clearAllMocks());

describe("falhas do worker", () => {
  it("job que falha é registrado e continua falhando para o pg-boss", async () => {
    const failure = new Error("falhou");
    const job = reportingFailures("market-data", async () => {
      throw failure;
    });

    await expect(job(undefined)).rejects.toBe(failure);
    expect(db.captureError).toHaveBeenCalledWith(failure, {
      service: "worker",
      source: "job",
      route: "job:market-data",
    });
  });

  it("job que dá certo não registra nada", async () => {
    await reportingFailures("market-data", async () => {})(undefined);
    expect(db.captureError).not.toHaveBeenCalled();
  });

  it("agente é registrado sem a família", async () => {
    const failure = new Error("falhou");
    await reportAgentFailure("metas", failure);
    expect(db.captureError).toHaveBeenCalledWith(failure, {
      service: "worker",
      source: "agent",
      route: "agente:metas",
    });
  });
});
