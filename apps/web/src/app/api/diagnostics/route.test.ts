import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  captureEvent: vi.fn().mockResolvedValue(undefined),
  describeClientError: vi.fn((fingerprint: string, route: string) => ({ fingerprint, route })),
}));
vi.mock("@organizeup/db", () => db);

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
    expect(db.describeClientError).toHaveBeenCalledWith(fingerprint, "/app/metas/[id]");
    expect(db.captureEvent).toHaveBeenCalledOnce();
  });

  it.each([
    ["campo a mais", { fingerprint, route: "/app", message: "ana@example.com" }],
    ["impressão digital fora do formato", { fingerprint: "ana@example.com", route: "/app" }],
    ["rota que não é caminho", { fingerprint, route: "https://site.example.com" }],
    ["rota com e-mail real", { fingerprint, route: "/app/ana@gmail.com" }],
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
});
