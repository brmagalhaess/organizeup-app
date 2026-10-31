// Teste de integração dos agentes diários: reaproveita o Postgres embutido e as migrações do
// pacote de banco (global-setup de packages/db), numa porta diferente para não brigar com o
// teste de RLS quando os dois rodam na mesma máquina.
import { defineConfig } from "vitest/config";

// O global-setup roda no processo principal e lê a porta de process.env antes de `test.env`
// chegar aos workers; por isso a porta também é definida aqui.
process.env.TEST_PG_PORT ??= "54349";

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
