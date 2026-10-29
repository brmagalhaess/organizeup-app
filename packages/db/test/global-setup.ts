// Prepara um banco de teste migrado. Em CI, TEST_DATABASE_OWNER_URL aponta para o service
// container; localmente sobe um Postgres embutido descartável.
import path from "node:path";
import type { TestProject } from "vitest/node";
import { migrate } from "../src/migrator";
import { startLocalPostgres, type LocalPostgres } from "../src/testing/local-postgres";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const PASSWORDS = { app: "test-app-pass", worker: "test-worker-pass", admin: "test-admin-pass" };

let local: LocalPostgres | undefined;

function withCredentials(ownerUrl: string, user: string, password: string): string {
  const url = new URL(ownerUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

export async function setup(project: TestProject) {
  let ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
  if (!ownerUrl) {
    local = await startLocalPostgres({
      dataDir: path.resolve(import.meta.dirname, "..", "..", "..", ".pg", "test"),
      port: Number(process.env.TEST_PG_PORT ?? 54339),
      persistent: false,
    });
    await local.createDatabase("organizeup_test");
    ownerUrl = local.ownerUrl("organizeup_test");
  }
  await migrate({ ownerUrl, passwords: PASSWORDS, log: () => {} });
  // Segunda execução precisa ser no-op (idempotência).
  await migrate({ ownerUrl, passwords: PASSWORDS, log: () => {} });
  project.provide("dbUrls", {
    owner: ownerUrl,
    app: withCredentials(ownerUrl, "ou_app", PASSWORDS.app),
    worker: withCredentials(ownerUrl, "ou_worker", PASSWORDS.worker),
    admin: withCredentials(ownerUrl, "ou_admin", PASSWORDS.admin),
  });
}

export async function teardown() {
  await local?.stop();
}
