// Conexões. NÃO exportado pelo pacote: o resto do código só acessa o banco por
// withHousehold / withWorkerHousehold / withAdmin / helpers de ops e auth.
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PostgresJsDatabase<Schema>;

interface Pool {
  sql: postgres.Sql;
  db: Db;
}

const globalPools = globalThis as unknown as { __organizeupPools?: Map<string, Pool> };
const pools = (globalPools.__organizeupPools ??= new Map<string, Pool>());

interface PoolOptions {
  max: number;
  readOnly?: boolean;
}

function createPool(url: string, applicationName: string, options: PoolOptions): Pool {
  const sql = postgres(url, {
    max: options.max,
    idle_timeout: 60,
    connect_timeout: 30,
    connection: {
      application_name: applicationName,
      // Pool somente leitura: o banco recusa qualquer escrita, mesmo com BYPASSRLS.
      ...(options.readOnly ? { default_transaction_read_only: true } : {}),
    },
    onnotice: () => {},
  });
  return { sql, db: drizzle(sql, { schema }) };
}

function getPool(envVar: string, applicationName: string, options: PoolOptions): Pool {
  const url = process.env[envVar];
  if (!url) {
    throw new Error(`${envVar} não configurada.`);
  }
  const key = `${envVar}|${applicationName}|${url}`;
  let pool = pools.get(key);
  if (!pool) {
    pool = createPool(url, applicationName, options);
    pools.set(key, pool);
  }
  return pool;
}

const appMax = () => Number(process.env.DATABASE_POOL_MAX ?? 10);
const adminMax = () => Number(process.env.ADMIN_DATABASE_POOL_MAX ?? 2);

/** Conexão da aplicação (web: ou_app; worker: ou_worker). Sujeita à RLS. */
export function appPool(): Pool {
  return getPool("DATABASE_URL", process.env.OU_PROCESS ?? "organizeup", { max: appMax() });
}

/** Conexão administrativa (ou_admin, BYPASSRLS) com escrita. Poucas conexões; uso restrito e auditado. */
export function adminPool(): Pool {
  return getPool("ADMIN_DATABASE_URL", "organizeup-admin", { max: adminMax() });
}

/**
 * Conexão administrativa SOMENTE LEITURA, para o painel do serviço na web. Poucas conexões
 * (ADMIN_DATABASE_POOL_MAX, padrão 2): é uma tela de uso raro.
 */
export function adminReadPool(): Pool {
  return getPool("ADMIN_DATABASE_URL", "organizeup-admin-ro", {
    max: adminMax(),
    readOnly: true,
  });
}

/** Fecha todas as conexões (testes e desligamento gracioso). */
export async function closeAllPools(): Promise<void> {
  const all = [...pools.values()];
  pools.clear();
  await Promise.all(all.map((p) => p.sql.end({ timeout: 5 })));
}
