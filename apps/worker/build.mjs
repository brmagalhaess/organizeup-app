// Gera dist/main.js (todas as dependências num arquivo) + dist/migrations (SQL do migrador).
import { cp, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  legalComments: "none",
  // Dependências CJS que usam require() de módulos nativos do Node.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  // Só usado em testes/desenvolvimento.
  external: ["embedded-postgres"],
  logLevel: "warning",
};

await build({ ...shared, entryPoints: ["src/main.ts"], outfile: "dist/main.js" });
// Processo isolado que abre arquivo enviado pela família: fica ao lado do main.js (ADR-0030).
await build({
  ...shared,
  entryPoints: ["../../packages/ai/src/importador/read-child.ts"],
  outfile: "dist/smart-read-child.js",
});

await cp("../../packages/db/migrations", "dist/migrations", { recursive: true });
console.log("worker: dist/main.js + dist/smart-read-child.js + dist/migrations");
