// Impressão digital e limpeza dos diagnósticos: a mensagem do erro nunca sai daqui.
import { describe, expect, it, vi } from "vitest";
import { captureError, describeError, normalizeRoute } from "../src/diagnostics";

const origin = {
  service: "web",
  source: "render",
  route: "/app/metas/[id]",
  commit: "abc1234",
} as const;

/** Monta um erro com pilha fixa, como no servidor em produção. */
function failure(message: string, frames: string[], name = "TypeError") {
  const error = new Error(message);
  error.name = name;
  error.stack = [`${name}: ${message}`, ...frames].join("\n");
  return error;
}

const FRAMES = [
  "    at parse (/repo/node_modules/.pnpm/zod@4/node_modules/zod/index.js:10:5)",
  "    at node:internal/process/task_queues:95:5",
  "    at saveGoal (/repo/apps/web/src/lib/goals.ts:42:9)",
  "    at async run (/repo/packages/db/src/tenant.ts:88:3)",
];

const SENSITIVE = /ana@example\.com|1\.234,56|R\$|Ana|mensagem/;

describe("limpeza do erro", () => {
  it("um erro com e-mail e valor em reais na mensagem não deixa nada disso no registro", () => {
    const message = "Falha ao salvar a meta de ana@example.com no valor de R$ 1.234,56";
    const event = describeError(failure(message, FRAMES), origin);

    expect(JSON.stringify(event)).not.toMatch(SENSITIVE);
    expect(event).toMatchObject({
      errorType: "TypeError",
      route: "/app/metas/[id]",
      stack: ["apps/web/src/lib/goals.ts:42", "packages/db/src/tenant.ts:88"],
    });
  });

  it("mensagem de várias linhas que imita a pilha também não entra", () => {
    const message = [
      "falhou",
      "    at ana@example.com (/repo/apps/web/src/ana.ts:1:1)",
      "    at /repo/apps/web/src/R$1.234,56.ts:2:2",
    ].join("\n");
    const event = describeError(failure(message, FRAMES), origin);

    expect(JSON.stringify(event)).not.toMatch(SENSITIVE);
    expect(event.stack).toEqual(["apps/web/src/lib/goals.ts:42", "packages/db/src/tenant.ts:88"]);
  });

  it("nome de tipo e código fora do formato não passam", () => {
    const named = failure("x", [], "ana@example.com");
    Object.assign(named, { code: "conta de ana@example.com" });
    const event = describeError(named, origin);
    expect(event.errorType).toBe("Error");
    expect(event.code).toBeNull();
  });

  it("acha o código do Postgres na causa", () => {
    const wrapped = new Error("Failed query: select ana@example.com", {
      cause: Object.assign(new Error("x"), { code: "42P01" }),
    });
    expect(describeError(wrapped, origin).code).toBe("42P01");
  });

  it("guarda a coluna só em arquivo gerado, que é minificado", () => {
    const built = "    at Page (/app/apps/web/.next/server/app/app/(painel)/metas/page.js:1:2345)";
    expect(describeError(failure("x", [built]), origin).stack).toEqual([
      ".next/server/app/app/(painel)/metas/page.js:1:2345",
    ]);
  });

  it("deixa de fora os pacotes do Next dentro do build", () => {
    const frames = [
      "    at act (/app/.next/server/chunks/ssr/_0m18_mpaycp6g._.js:1:214)",
      "    at x (/app/.next/server/chunks/ssr/0h9u_next_dist_0qi02wn2pnbex._.js:1:11796)",
    ];
    expect(describeError(failure("x", frames), origin).stack).toEqual([
      ".next/server/chunks/ssr/_0m18_mpaycp6g._.js:1:214",
    ]);
  });

  it("entende caminho com espaço e file:// do Windows", () => {
    const windows = "    at run (file:///C:/Users/User/Nova pasta/packages/db/src/ops.ts:12:3)";
    expect(describeError(failure("x", [windows]), origin).stack).toEqual([
      "packages/db/src/ops.ts:12",
    ]);
  });

  it("a pilha do worker depois do mapa de fontes continua nossa", () => {
    const mapped = "    at runDailyAgents (/src/daily-agents.ts:60:12)";
    expect(describeError(failure("x", [mapped]), origin).stack).toEqual(["src/daily-agents.ts:60"]);
  });

  it("valor que não é erro vira um tipo genérico", () => {
    const event = describeError("ana@example.com", origin);
    expect(event).toMatchObject({ errorType: "Error", code: null, stack: [] });
    expect(JSON.stringify(event)).not.toMatch(SENSITIVE);
  });
});

describe("impressão digital", () => {
  const fingerprint = (message: string, frames = FRAMES, over = {}) =>
    describeError(failure(message, frames), { ...origin, ...over }).fingerprint;

  it("não muda com a mensagem, a linha ou a versão", () => {
    const moved = FRAMES.map((frame) => frame.replace(":42:9", ":77:1"));
    const base = fingerprint("meta de ana@example.com");
    expect(base).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprint("meta de beto@example.com")).toBe(base);
    expect(fingerprint("outra", moved)).toBe(base);
    expect(fingerprint("outra", FRAMES, { commit: "def5678" })).toBe(base);
  });

  it("ignora arquivo gerado, cujo nome muda a cada build", () => {
    const build = (chunk: string) => [
      `    at x (/app/apps/web/.next/server/chunks/${chunk}.js:1:2)`,
    ];
    expect(fingerprint("x", build("aaa"))).toBe(fingerprint("x", build("bbb")));
  });

  it("muda com a rota, a origem, o tipo e o arquivo", () => {
    const base = fingerprint("x");
    expect(fingerprint("x", FRAMES, { route: "/app/viagens/[id]" })).not.toBe(base);
    expect(fingerprint("x", FRAMES, { source: "action" })).not.toBe(base);
    expect(fingerprint("x", FRAMES.slice(3))).not.toBe(base);
    expect(describeError(failure("x", FRAMES, "RangeError"), origin).fingerprint).not.toBe(base);
  });
});

describe("rota normalizada", () => {
  it.each([
    ["/app/(painel)/metas/[id]/page", "/app/metas/[id]"],
    ["/app/metas/[id]", "/app/metas/[id]"],
    ["/api/ops/context/route", "/api/ops/context"],
    ["/api/auth/[...all]", "/api/auth/[...all]"],
    ["/app/metas?q=ana@example.com#x", "/app/metas"],
    ["/app/metas/3f2c8a10-1111-2222-3333-444455556666", "/app/metas/[id]"],
    ["/convite/abc123/aceitar", "/convite/[id]/aceitar"],
    ["/admin/usuarios/ana@example.com", "/admin/usuarios/[id]"],
    ["/app/Ana Silva/1234", "/app/[id]/[id]"],
    ["/", "/"],
    ["job:market-data", "job:market-data"],
    ["agente:metas", "agente:metas"],
    ["ana@example.com", "/desconhecida"],
    ["job:Ana Silva", "/desconhecida"],
  ])("%s vira %s", (route, expected) => {
    expect(normalizeRoute(route)).toBe(expected);
  });
});

describe("registro", () => {
  it("falha ao registrar nunca chega a quem chamou", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(captureError(new Error("ana@example.com"), origin)).resolves.toBeUndefined();
    } finally {
      process.env.DATABASE_URL = previous;
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain("ana@example.com");
    log.mockRestore();
  });
});
