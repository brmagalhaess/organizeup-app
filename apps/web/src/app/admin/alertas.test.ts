import { describe, expect, it } from "vitest";
import { buildAlerts, knowledgeExpired } from "./alertas";

const now = new Date("2026-10-31T15:00:00Z");
const quiet = {
  now,
  today: "2026-10-31",
  hour: 12,
  runs: [{ day: "2026-10-31", agent: "metas", failed: 0 }],
  workers: [{ lastSeenAt: new Date("2026-10-31T14:58:00Z") }],
  deployments: [],
  queues: [],
  diagnostics: [] as Array<{ firstSeenAt: Date }>,
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

  it("agente sem rodar até as 06:00 é cobrado pelo nome", () => {
    const expectedAgents = [
      { id: "metas", name: "Metas" },
      { id: "viagens", name: "Viagens" },
    ];
    const [one] = buildAlerts({ ...quiet, expectedAgents });
    expect(one).toMatchObject({ key: "agentes:faltando", title: "Viagens sem rodar hoje" });
    expect(keys({ hour: 5, expectedAgents } as object)).toEqual([]);
    expect(keys({ maintenance: true, expectedAgents } as object)).toEqual(["manutencao"]);

    const runs = [{ day: "2026-10-31", agent: "mercado", failed: 0 }];
    const [many] = buildAlerts({ ...quiet, runs, expectedAgents });
    expect(many).toMatchObject({ key: "agentes:faltando", title: "Agentes sem rodar hoje" });
    expect(many!.text).toContain("Metas, Viagens");
  });

  it("dicas sem rodar só avisam depois das 07:00 e quando deviam rodar", () => {
    const at = (input: object) =>
      buildAlerts({ ...quiet, insightsExpected: true, ...input }).map((alert) => alert.key);
    expect(at({})).toEqual(["dicas:sem_rodada"]);
    expect(at({ hour: 6 })).toEqual([]);
    expect(at({ insightsExpected: false })).toEqual([]);
    expect(
      at({
        runs: [
          { day: "2026-10-31", agent: "metas", failed: 0 },
          { day: "2026-10-31", agent: "dicas", failed: 0 },
        ],
      }),
    ).toEqual([]);
  });

  it("Testar a IA que falhou avisa até passar", () => {
    const at = (ok: boolean) =>
      buildAlerts({ ...quiet, aiTest: { ok, at: now } }).map((alert) => alert.key);
    expect(at(false)).toEqual(["ia:teste"]);
    expect(at(true)).toEqual([]);
    expect(keys({ aiTest: null } as object)).toEqual([]);
  });

  it("worker sem a chave da IA avisa; sem sinal dele, não", () => {
    expect(keys({ workerHasAiKey: false } as object)).toEqual(["ia:worker"]);
    expect(keys({ workerHasAiKey: true } as object)).toEqual([]);
    expect(keys({ workerHasAiKey: null } as object)).toEqual([]);
  });

  it("catálogo velho há mais de 2 dias avisa", () => {
    const at = (catalogUpdatedAt: Date | null | undefined) =>
      buildAlerts({ ...quiet, catalogUpdatedAt });
    expect(at(undefined)).toEqual([]);
    expect(at(new Date("2026-10-30T15:00:00Z"))).toEqual([]);
    expect(at(new Date("2026-10-28T15:00:00Z"))[0]).toMatchObject({
      key: "mercado:catalogo",
      title: "Catálogo de ativos velho",
    });
    expect(at(null)[0]).toMatchObject({ title: "Catálogo de ativos vazio" });
  });

  it("base do assistente vence depois de 12 meses", () => {
    expect(knowledgeExpired("2025-10-31", "2026-10-31")).toBe(false);
    expect(knowledgeExpired("2025-10-30", "2026-10-31")).toBe(true);
    expect(keys({ knowledgeOldest: "2026-01-10" } as object)).toEqual([]);
    expect(keys({ knowledgeOldest: "2025-01-10" } as object)).toEqual(["base:vencida"]);
    expect(keys({ knowledgeOldest: null } as object)).toEqual([]);
  });

  it("falha do Mercado fala de consultas, não de famílias", () => {
    const [alert] = buildAlerts({
      ...quiet,
      runs: [{ day: "2026-10-31", agent: "mercado", failed: 2 }],
    });
    expect(alert!.text).toBe("2 consultas falharam em 31/10/2026.");
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

  it("erro aberto só é alerta nas primeiras 24 horas", () => {
    const old = { firstSeenAt: new Date("2026-10-29T15:00:00Z") };
    const fresh = { firstSeenAt: new Date("2026-10-31T14:00:00Z") };
    expect(keys({ diagnostics: [old] })).toEqual([]);
    const [alert] = buildAlerts({ ...quiet, diagnostics: [old, fresh] });
    expect(alert).toMatchObject({ key: "erros", tone: "danger", href: "/admin/sistema" });
    expect(alert!.text).toContain("1 erro");
    expect(buildAlerts({ ...quiet, diagnostics: [fresh, fresh] })[0]!.text).toContain("2 erros");
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
