// Prepara um banco de teste migrado. Em CI, TEST_DATABASE_OWNER_URL aponta para o service
// container; localmente sobe um Postgres embutido descartável.
//
// Cada pacote (db, agents, web, worker) precisa começar do zero: localmente o embutido é apagado a
// cada execução, e no CI o banco externo é recriado aqui, senão o que o teste de RLS semeia
// (PETR4, câmbio, eventos) vaza para o teste do job de mercado e muda as contagens.
import path from "node:path";
import postgres from "postgres";
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

/**
 * O embedded-postgres registra um gancho que encerra com `process.exit(0)` e apagaria o código de falha
 * do Vitest: teste vermelho sairia como sucesso, e o `pnpm check` passaria. Vale o `exitCode` já marcado.
 */
function keepFailureExitCode() {
  const exit = process.exit.bind(process);
  process.exit = ((code?: number) => exit(code || process.exitCode)) as typeof process.exit;
}

/**
 * Apaga e recria o banco de teste externo, pela base de manutenção `postgres` do mesmo servidor.
 * Só para banco cujo nome diz "test": a variável nunca deve apontar para dado de verdade, e esta
 * guarda evita o pior caso. Os papéis (ou_app, ou_worker, ou_admin) são do servidor e ficam.
 */
async function recreateDatabase(ownerUrl: string) {
  const url = new URL(ownerUrl);
  const database = url.pathname.replace(/^\//, "");
  if (!/test/i.test(database)) {
    throw new Error("TEST_DATABASE_OWNER_URL precisa apontar para um banco com 'test' no nome");
  }
  url.pathname = "/postgres";
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await sql`drop database if exists ${sql(database)} with (force)`;
    await sql`create database ${sql(database)}`;
  } finally {
    await sql.end();
  }
}

export async function setup(project: TestProject) {
  keepFailureExitCode();
  let ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
  if (ownerUrl) {
    await recreateDatabase(ownerUrl);
  } else {
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
