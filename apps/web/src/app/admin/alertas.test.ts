import { describe, expect, it } from "vitest";
import { buildAlerts } from "./alertas";

const now = new Date("2026-10-31T15:00:00Z");
const quiet = {
  now,
  today: "2026-10-31",
  hour: 12,
  runs: [{ day: "2026-10-31", agent: "metas", failed: 0 }],
  workers: [{ lastSeenAt: new Date("2026-10-31T14:58:00Z") }],
  deployments: [],
  queues: [],
  statsDay: "2026-10-31",
  maintenance: false,
  signupClosed: false,
  allAgentsOff: false,
};
const keys = (input: Partial<typeof quiet> & object) =>
  buildAlerts({ ...quiet, ...input }).map((alert) => alert.key);

describe("alertas do painel", () => {
  it("dia normal não gera alerta", () => {
    expect(keys({})).toEqual([]);
  });

  it("agente com falha e worker sem sinal vêm primeiro", () => {
    expect(
      keys({
        runs: [{ day: "2026-10-31", agent: "metas", failed: 2 }],
        workers: [{ lastSeenAt: new Date("2026-10-31T14:00:00Z") }],
        maintenance: true,
      }),
    ).toEqual(["agente:metas", "worker", "manutencao"]);
  });

  it("teto de IA: avisa perto e alerta ao bater", () => {
    const at = (spentUsd: number) =>
      buildAlerts({ ...quiet, aiSpend: { spentUsd, budgetUsd: 50, reached: spentUsd >= 50 } }).map(
        (alert) => alert.key,
      );
    expect(at(10)).toEqual([]);
    expect(at(40)).toEqual(["ia:perto"]);
    expect(at(50)).toEqual(["ia:teto"]);
  });

  it("sem worker nenhum também avisa", () => {
    expect(keys({ workers: [] })).toEqual(["worker"]);
  });

  it("rodada que não veio só avisa depois da hora e fora da manutenção", () => {
    const runs = [{ day: "2026-10-30", agent: "metas", failed: 0 }];
    expect(keys({ runs })).toEqual(["agentes:sem_rodada"]);
    expect(keys({ runs, hour: 5 })).toEqual([]);
    expect(keys({ runs, maintenance: true })).toEqual(["manutencao"]);
    expect(keys({ runs, allAgentsOff: true })).toEqual([]);
  });

  it("deploy atrasado respeita a folga de subida", () => {
    const deployments: Array<{ service: "web" | "worker"; commit: string; startedAt: Date }> = [
      { service: "web", commit: "aaaaaaa1", startedAt: new Date("2026-10-31T14:50:00Z") },
      { service: "worker", commit: "bbbbbbb2", startedAt: new Date("2026-10-30T10:00:00Z") },
    ];
    expect(
      buildAlerts({ ...quiet, deployments }).map((alert) => alert.key),
      "dentro da folga",
    ).toEqual([]);
    const later = new Date("2026-10-31T15:30:00Z");
    const late = buildAlerts({
      ...quiet,
      deployments,
      now: later,
      workers: [{ lastSeenAt: later }],
    });
    expect(late.map((alert) => alert.key)).toEqual(["deploy"]);
    expect(late[0]!.text).toContain("aaaaaaa");
  });
});
