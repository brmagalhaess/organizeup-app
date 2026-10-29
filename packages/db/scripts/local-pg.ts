// Sobe um Postgres local persistente (porta 54329) e aplica as migrações.
// Uso: pnpm db:local  (Ctrl+C para parar). Credenciais em .env.example.
import path from "node:path";
import { migrate } from "../src/migrator";
import { startLocalPostgres } from "../src/testing/local-postgres";

const port = Number(process.env.LOCAL_PG_PORT ?? 54329);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const pg = await startLocalPostgres({
  dataDir: path.join(repoRoot, ".pg", "dev"),
  port,
  persistent: true,
});
await pg.createDatabase("organizeup");
await migrate({
  ownerUrl: pg.ownerUrl("organizeup"),
  passwords: {
    app: process.env.OU_APP_DB_PASSWORD ?? "dev-app-pass",
    worker: process.env.OU_WORKER_DB_PASSWORD ?? "dev-worker-pass",
    admin: process.env.OU_ADMIN_DB_PASSWORD ?? "dev-admin-pass",
  },
});
console.log(`Postgres local pronto em 127.0.0.1:${port} (banco organizeup). Ctrl+C para parar.`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
await new Promise(() => {});
