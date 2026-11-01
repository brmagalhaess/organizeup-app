import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  listDiagnostics: vi.fn(),
  listDiagnosticRates: vi.fn(),
  resolveDiagnostic: vi.fn(),
}));
vi.mock("@organizeup/db", () => db);

const { GET, POST } = await import("./route");

const TOKEN = "t".repeat(40);
const fingerprint = "a".repeat(32);
const url = "https://site.example.com/api/ops/diagnostics";
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeEach(() => {
  process.env.OPS_TOKEN_HASHES = createHash("sha256").update(TOKEN).digest("hex");
  vi.clearAllMocks();
  db.listDiagnostics.mockResolvedValue([{ fingerprint, count: 2 }]);
  db.listDiagnosticRates.mockResolvedValue([{ commit: "abc", perHour: 1 }]);
  db.resolveDiagnostic.mockResolvedValue(2);
});

describe("GET /api/ops/diagnostics", () => {
  it("recusa sem token e com token errado", async () => {
    for (const headers of [{}, auth("x".repeat(40))]) {
      const response = await GET(new Request(url, { headers }));
      expect(response.status).toBe(401);
    }
    expect(db.listDiagnostics).not.toHaveBeenCalled();
  });

  it("com o token certo, devolve os erros e repassa os filtros", async () => {
    const query = "?status=todos&service=web&commit=abc&route=/app/metas&limit=5";
    const response = await GET(new Request(url + query, { headers: auth(TOKEN) }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      diagnostics: [{ fingerprint, count: 2 }],
      errorRates: [{ commit: "abc", perHour: 1 }],
    });
    expect(db.listDiagnostics).toHaveBeenCalledWith({
      status: "todos",
      service: "web",
      commit: "abc",
      route: "/app/metas",
      limit: 5,
    });
  });

  it("filtro inválido é 422", async () => {
    for (const query of ["?status=outro", "?limit=0", "?since=ontem", "?fingerprint=x"]) {
      const response = await GET(new Request(url + query, { headers: auth(TOKEN) }));
      expect(response.status, query).toBe(422);
    }
  });
});

describe("POST /api/ops/diagnostics", () => {
  const post = (headers: Record<string, string>, body: unknown) =>
    POST(new Request(url, { method: "POST", headers, body: JSON.stringify(body) }));

  it("recusa com token errado", async () => {
    expect((await post(auth("x".repeat(40)), { fingerprint })).status).toBe(401);
    expect(db.resolveDiagnostic).not.toHaveBeenCalled();
  });

  it("marca resolvido", async () => {
    const response = await post(auth(TOKEN), { fingerprint });
    expect(await response.json()).toEqual({ resolved: 2 });
    expect(db.resolveDiagnostic).toHaveBeenCalledWith(fingerprint);
  });

  it("impressão digital fora do formato é 422", async () => {
    expect((await post(auth(TOKEN), { fingerprint: "ana@example.com" })).status).toBe(422);
    expect(db.resolveDiagnostic).not.toHaveBeenCalled();
  });
});
