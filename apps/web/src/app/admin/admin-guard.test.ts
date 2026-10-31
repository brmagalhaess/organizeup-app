// Trava de revisão: toda server action do painel começa conferindo o administrador.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = import.meta.dirname;
const actionFiles = readdirSync(dir, { recursive: true, encoding: "utf8" })
  .filter((file) => path.basename(file) === "actions.ts")
  .map((file) => path.join(dir, file));

/** Cada `export async function`, até o `}` na primeira coluna que a fecha. */
function exportedBodies(source: string) {
  return [...source.matchAll(/^export async function (\w+)[\s\S]*?^}/gm)].map((match) => ({
    name: match[1]!,
    body: match[0],
  }));
}

describe("server actions do painel", () => {
  it("existem os arquivos de ação das telas", () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(5);
  });

  it.each(actionFiles)("%s exige administrador em cada ação", (file) => {
    const bodies = exportedBodies(readFileSync(file, "utf8"));
    expect(bodies.length).toBeGreaterThan(0);
    for (const { name, body } of bodies) {
      expect(body, name).toContain("await requireAdmin()");
    }
  });
});
