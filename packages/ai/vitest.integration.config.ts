// Ferramentas e loop contra um Postgres real com RLS. Reaproveita o Postgres embutido e as migrações
// de packages/db, numa porta própria para não brigar com os outros testes de integração.
import { defineConfig } from "vitest/config";

// O global-setup roda no processo principal e lê a porta de process.env antes de `test.env`
// chegar aos workers; por isso a porta também é definida aqui.
process.env.TEST_PG_PORT ??= "54351";

export default defineConfig({
  test: {
    include: ["test/**/*.integration.test.ts"],
    globalSetup: ["../db/test/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    env: { TEST_PG_PORT: process.env.TEST_PG_PORT },
  },
});
