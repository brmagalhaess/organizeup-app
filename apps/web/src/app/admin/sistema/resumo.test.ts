import { describe, expect, it } from "vitest";
import { aiByDay, aiByRoute, cacheShare, insightsByDay, routeLabel } from "./resumo";

const row = (day: string, route: string, calls: number, costUsd: string) => ({
  day,
  route,
  calls,
  inputTokens: 100,
  cacheReadTokens: 300,
  cacheWriteTokens: 0,
  costUsd,
});

describe("uso de IA", () => {
  const rows = [
    row("2026-10-31", "noite", 8, "0.200000"),
    row("2026-10-31", "chat", 2, "0.100000"),
    row("2026-10-30", "chat", 1, "0.150000"),
    row("2026-10-30", "classificacao", 3, "0.010000"),
  ];

  it("soma por rota, inclusive a que apareceu agora, da que mais gastou", () => {
    const routes = aiByRoute(rows);
    expect(routes.map((item) => item.route)).toEqual(["chat", "noite", "classificacao"]);
    expect(routes[0]).toMatchObject({ calls: 3, cacheReadTokens: 600 });
    expect(routes[0]!.costUsd).toBeCloseTo(0.25);
    expect(routeLabel("noite")).toBe("Dicas da madrugada");
    expect(routeLabel("classificacao")).toBe("classificacao");
  });

  it("dia sem uso fica zerado no lugar certo", () => {
    const days = aiByDay(rows, ["2026-10-29", "2026-10-30", "2026-10-31"]);
    expect(days.map((item) => item.calls)).toEqual([0, 4, 10]);
    expect(days[2]!.routes.map((item) => item.route)).toEqual(["noite", "chat"]);
    expect(days[0]!.routes).toEqual([]);
  });

  it("cache lido é a parte da entrada que veio do cache", () => {
    expect(cacheShare(row("2026-10-31", "chat", 1, "0"))).toBe("75%");
    expect(cacheShare({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe("sem uso");
  });
});

describe("dicas por dia", () => {
  it("junta rodadas e descartes do agente, do dia mais novo ao mais antigo", () => {
    const base = { agent: "dicas", ok: 3, failed: 1, suggestions: 5 };
    const days = insightsByDay(
      [
        { ...base, day: "2026-10-30" },
        { ...base, day: "2026-10-31" },
        { ...base, day: "2026-10-01" },
        { ...base, day: "2026-10-31", agent: "metas" },
      ],
      [
        { day: "2026-10-31", agent: "dicas", discarded: 2 },
        { day: "2026-10-30", agent: "categorias", discarded: 9 },
      ],
      "dicas",
      "2026-10-18",
    );
    expect(days).toEqual([
      { day: "2026-10-31", families: 3, failed: 1, created: 5, discarded: 2 },
      { day: "2026-10-30", families: 3, failed: 1, created: 5, discarded: 0 },
    ]);
  });
});
