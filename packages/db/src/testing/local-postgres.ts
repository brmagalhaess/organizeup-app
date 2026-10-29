// Postgres real e descartável para desenvolvimento e testes locais (sem Docker).
// Em CI usamos o service container do GitHub Actions em vez disto.
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

export interface LocalPostgres {
  ownerUrl: (database: string) => string;
  createDatabase: (database: string) => Promise<void>;
  stop: () => Promise<void>;
}

export async function startLocalPostgres(options: {
  dataDir: string;
  port: number;
  persistent: boolean;
}): Promise<LocalPostgres> {
  const user = "postgres";
  const password = "postgres";
  if (!options.persistent) {
    await rm(options.dataDir, { recursive: true, force: true });
  }
  await mkdir(path.dirname(options.dataDir), { recursive: true });
  const pg = new EmbeddedPostgres({
    databaseDir: options.dataDir,
    user,
    password,
    port: options.port,
    persistent: options.persistent,
    onLog: () => {},
    onError: () => {},
  });
  const { existsSync } = await import("node:fs");
  if (!existsSync(path.join(options.dataDir, "PG_VERSION"))) {
    await pg.initialise();
  }
  await pg.start();
  return {
    ownerUrl: (database) => `postgres://${user}:${password}@127.0.0.1:${options.port}/${database}`,
    createDatabase: async (database) => {
      try {
        await pg.createDatabase(database);
      } catch (err) {
        if (!String(err).includes("already exists")) throw err;
      }
    },
    stop: () => pg.stop(),
  };
}
