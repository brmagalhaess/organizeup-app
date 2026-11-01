// Integração das telas de dinheiro: chama as server actions de verdade contra um Postgres real com RLS,
// só com a sessão e o cache do Next.js simulados. Reaproveita o global-setup de packages/db, em porta própria.
import path from "node:path";
import { defineConfig } from "vitest/config";

// O global-setup roda no processo principal e lê a porta antes de `test.env` chegar aos workers.
process.env.TEST_PG_PORT ??= "54353";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "src/test/server-only.ts"),
    },
  },
  test: {
    include: ["src/**/*.integration.test.ts"],
    globalSetup: ["../../packages/db/test/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    env: { TEST_PG_PORT: process.env.TEST_PG_PORT },
  },
});
