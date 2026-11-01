import { afterEach, describe, expect, it, vi } from "vitest";
import { screenRoute, sendScreenError } from "./screen-error";

afterEach(() => vi.unstubAllGlobals());

describe("rota da tela", () => {
  it("troca os valores dos parâmetros pelos nomes", () => {
    expect(screenRoute("/app/metas/abc-123", { id: "abc-123" })).toBe("/app/metas/[id]");
    expect(screenRoute("/app/a/b/c", { slug: ["b", "c"] })).toBe("/app/a/[slug]/[slug]");
    expect(screenRoute("/app/metas", {})).toBe("/app/metas");
  });
});

describe("aviso do navegador", () => {
  const failure = (message: string) => {
    const error = new TypeError(message);
    error.stack = `TypeError: ${message}\n    at foo (https://site.example.com/_next/a.js:1:2)`;
    return error;
  };

  async function sent(message: string) {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", send);
    await sendScreenError(failure(message), "/app/metas/[id]");
    const [url, init] = send.mock.calls[0] as [string, RequestInit];
    return { url, raw: init.body as string, body: JSON.parse(init.body as string) as object };
  }

  it("envia só impressão digital e rota", async () => {
    const { url, raw, body } = await sent("Falhou para ana@example.com: R$ 1.234,56");
    expect(url).toBe("/api/diagnostics");
    expect(Object.keys(body).sort()).toEqual(["fingerprint", "route"]);
    expect(body).toMatchObject({
      fingerprint: expect.stringMatching(/^[0-9a-f]{32}$/),
      route: "/app/metas/[id]",
    });
    expect(raw).not.toMatch(/ana@example|1\.234|_next/);
  });

  it("a mensagem não muda a impressão digital", async () => {
    expect((await sent("uma")).body).toEqual((await sent("outra")).body);
  });

  it("sem rede, a tela de erro não sofre", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(sendScreenError(failure("x"), "/app")).resolves.toBeUndefined();
  });
});
