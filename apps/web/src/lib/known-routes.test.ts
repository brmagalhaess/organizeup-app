// O catálogo de rotas dos diagnósticos é fechado: tela que falta nele vira "/desconhecida", e o erro dela
// perde o endereço. Este teste lê as telas e rotas de verdade.
import { readdirSync } from "node:fs";
import path from "node:path";
import { normalizeRoute } from "@organizeup/db";
import { describe, expect, it } from "vitest";

const app = path.resolve(import.meta.dirname, "../app");

/** O endereço de cada `page.tsx` e `route.ts`, sem os grupos entre parênteses. */
const routes = readdirSync(app, { recursive: true, encoding: "utf8" })
  .map((file) => file.split(path.sep))
  .filter((parts) => ["page.tsx", "route.ts"].includes(parts.at(-1)!))
  .map((parts) => {
    const segments = parts.slice(0, -1).filter((part) => !/^\(.*\)$/.test(part));
    return `/${segments.join("/")}`;
  });

describe("rotas conhecidas dos diagnósticos", () => {
  it("achou as telas", () => {
    expect(routes.length).toBeGreaterThan(60);
    expect(routes).toContain("/confirmar-email");
  });

  it("toda tela e toda rota do app estão no catálogo", () => {
    const missing = routes.filter((route) => normalizeRoute(route) !== route);
    expect(missing).toEqual([]);
  });
});
