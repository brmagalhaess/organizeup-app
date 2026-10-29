// Gera dist/main.js (todas as dependências num arquivo) + dist/migrations (SQL do migrador).
import { cp, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
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
});

await cp("../../packages/db/migrations", "dist/migrations", { recursive: true });
console.log("worker: dist/main.js + dist/migrations");
