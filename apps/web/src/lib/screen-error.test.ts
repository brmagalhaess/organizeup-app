import { afterEach, describe, expect, it, vi } from "vitest";
import { describeClientError } from "@organizeup/db";
import {
  isStaleBuild,
  screenRecovery,
  screenRoute,
  sendScreenError,
  worthReporting,
} from "./screen-error";

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

/**
 * ORG-279. O registro de produção não guarda pilha nem mensagem: só a impressão digital. Este caso
 * reproduz o caminho inteiro — nome do erro no navegador → impressão digital → linha do registro —
 * e prova de qual erro vieram as duas ocorrências em `/app/proventos` (c1b97409…, build ddcfc52) e
 * a de `/app/contas/conexoes` (6cf18911…). Sem ele, a próxima pessoa investiga do zero.
 */
describe("de qual erro é a impressão digital do registro", () => {
  async function recorded(name: string, route: string) {
    const error = new Error("mensagem que não entra na impressão digital");
    error.name = name;
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", send);
    await sendScreenError(error, route);
    const { fingerprint } = JSON.parse(
      (send.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as { fingerprint: string };
    return describeClientError(fingerprint, route).fingerprint;
  }

  it.each([
    ["/app/proventos", "c1b974093e5ed9182143de26459115d9"],
    ["/app/contas/conexoes", "6cf18911eb6f515f7b0312cdd62cf871"],
  ])("%s é ação de servidor que o build novo não tem", async (route, fingerprint) => {
    expect(await recorded("UnrecognizedActionError", route)).toBe(fingerprint);
  });

  it("não é erro comum de tela nem de dado", async () => {
    for (const name of ["Error", "TypeError", "RangeError", "ChunkLoadError"]) {
      expect(await recorded(name, "/app/proventos")).not.toBe("c1b974093e5ed9182143de26459115d9");
    }
  });
});

describe("página de antes do deploy", () => {
  const named = (name: string, extra: object = {}) =>
    Object.assign(new Error("qualquer"), { name }, extra);

  it("reconhece a ação de servidor que o build novo não tem", () => {
    expect(isStaleBuild(named("UnrecognizedActionError"))).toBe(true);
    expect(isStaleBuild(named("TypeError"))).toBe(false);
  });

  it("oferece recarregar, porque tentar de novo falharia igual", () => {
    expect(screenRecovery(named("UnrecognizedActionError"))).toBe("recarregar");
    expect(screenRecovery(named("TypeError"))).toBe("tentar");
  });

  /**
   * Oferecer recarregar não é calar. Se o despacho da ação quebrar no servidor de verdade (proxy
   * que corta cabeçalho, build publicado pela metade), o nome do erro é o mesmo, recarregar não
   * resolve, e o registro é a única chance de a equipe perceber. Só `digest` fica fora, porque o
   * servidor já registrou.
   */
  it("o aviso à equipe continua, inclusive para build velho", () => {
    expect(worthReporting(named("UnrecognizedActionError"))).toBe(true);
    expect(worthReporting(named("TypeError"))).toBe(true);
    expect(worthReporting(named("Error", { digest: "abc" }))).toBe(false);
    expect(worthReporting(named("UnrecognizedActionError", { digest: "abc" }))).toBe(false);
  });
});
