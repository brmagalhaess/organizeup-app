import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  captureEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@organizeup/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@organizeup/db")>()),
  captureEvent: db.captureEvent,
}));

const { POST } = await import("./route");

const fingerprint = "a".repeat(32);
let ip = 0;

/** Cada caso usa um IP próprio: o limite vive enquanto o módulo estiver carregado. */
function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("https://site.example.com/api/diagnostics", {
      method: "POST",
      headers: { "x-forwarded-for": `10.0.0.${ip}, 172.16.0.1`, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  ip += 1;
  vi.clearAllMocks();
});

describe("POST /api/diagnostics", () => {
  it("aceita impressão digital e rota", async () => {
    const response = await post({ fingerprint, route: "/app/metas/[id]" });
    expect(response.status).toBe(204);
    expect(db.captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({ route: "/app/metas/[id]" }),
    );
    expect(db.captureEvent).toHaveBeenCalledOnce();
  });

  it.each([
    ["/app/pessoa-ficticia", "/desconhecida"],
    ["/rota-ficticia", "/desconhecida"],
    ["/app/metas/pessoa-ficticia", "/app/metas/[id]"],
    ["/app/metas/[pessoa-ficticia]", "/app/metas/[id]"],
    ["/app/metas?busca=texto#fragmento", "/app/metas"],
    ["/job:pessoa-ficticia", "/desconhecida"],
    ["/agente:pessoa-ficticia", "/desconhecida"],
    ["/acao:pessoa_ficticia", "/desconhecida"],
  ])("entrega ao registro apenas a rota canônica de %s", async (route, expected) => {
    expect((await post({ fingerprint, route })).status).toBe(204);
    expect(db.captureEvent).toHaveBeenCalledWith(expect.objectContaining({ route: expected }));
  });

  it.each([
    ["campo a mais", { fingerprint, route: "/app", message: "ana@example.com" }],
    ["impressão digital fora do formato", { fingerprint: "ana@example.com", route: "/app" }],
    ["rota que não é caminho", { fingerprint, route: "https://site.example.com" }],
    ["rota com e-mail fictício", { fingerprint, route: "/app/pessoa@example.invalid" }],
    ["prefixo de job", { fingerprint, route: "job:market-data" }],
    ["prefixo de agente", { fingerprint, route: "agente:metas" }],
    ["prefixo de ação", { fingerprint, route: "acao:goal_replan_failed" }],
    ["corpo que não é JSON", "nao-e-json"],
  ])("recusa %s", async (_name, body) => {
    expect((await post(body)).status).toBe(422);
    expect(db.captureEvent).not.toHaveBeenCalled();
  });

  it("recusa corpo grande", async () => {
    const big = { fingerprint, route: `/${"a".repeat(2000)}` };
    expect((await post(big)).status).toBe(413);
    expect(db.captureEvent).not.toHaveBeenCalled();
  });

  it("segura o excesso por IP, sem afetar outro IP", async () => {
    const body = { fingerprint, route: "/app" };
    const headers = { "x-forwarded-for": "198.51.100.7" };
    const results: number[] = [];
    for (let time = 0; time < 21; time += 1) results.push((await post(body, headers)).status);
    expect(results.slice(0, 20).every((status) => status === 204)).toBe(true);
    expect(results[20]).toBe(429);
    expect((await post(body)).status).toBe(204);
  });
  it("mantém o teto global mesmo com IPs diferentes", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
    try {
      for (let n = 0; n < 300; n += 1) {
        expect(
          (
            await post(
              { fingerprint, route: "/app" },
              {
                "x-forwarded-for": `198.51.100.${n}`,
              },
            )
          ).status,
        ).toBe(204);
      }
      expect((await post({ fingerprint, route: "/app" })).status).toBe(429);
      expect(db.captureEvent).toHaveBeenCalledTimes(300);
    } finally {
      clock.mockRestore();
    }
  });
});
