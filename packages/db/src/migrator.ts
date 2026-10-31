// Migrador: roda com a credencial do DONO do banco (MIGRATION_DATABASE_URL), dentro do
// container do worker, antes do worker iniciar. A web nunca recebe essa credencial.
//
// Passos (idempotentes): lock → roles → migrations SQL → grants → pg-boss + filas → grants pg-boss.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { PgBoss } from "pg-boss";
import { JOB_QUEUES, PGBOSS_SCHEMA } from "./jobs";

export interface MigrateOptions {
  ownerUrl: string;
  /** Senhas dos roles de login. Se ausentes, roles existentes mantêm a senha atual. */
  passwords?: { app?: string | undefined; worker?: string | undefined; admin?: string | undefined };
  migrationsDir?: string;
  /** Instala/atualiza o pg-boss e cria as filas (padrão: true). */
  installJobs?: boolean;
  log?: (message: string) => void;
}

export const APP_ROLES = { app: "ou_app", worker: "ou_worker", admin: "ou_admin" } as const;

const LOCK_KEY = 72_310_001; // constante arbitrária para pg_advisory_lock

export function defaultMigrationsDir(): string {
  // Código-fonte: packages/db/src → ../migrations. Bundle do worker: dist/ → ./migrations.
  const fromEnv = process.env.MIGRATIONS_DIR;
  if (fromEnv) return fromEnv;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, "migrations"), path.resolve(here, "..", "migrations")];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[1]!;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function ensureRoles(sql: postgres.Sql, opts: MigrateOptions, log: (m: string) => void) {
  const specs: Array<{ name: string; password?: string | undefined; bypass: boolean }> = [
    { name: APP_ROLES.app, password: opts.passwords?.app, bypass: false },
    { name: APP_ROLES.worker, password: opts.passwords?.worker, bypass: false },
    { name: APP_ROLES.admin, password: opts.passwords?.admin, bypass: true },
  ];
  for (const spec of specs) {
    const exists = await sql`select 1 from pg_roles where rolname = ${spec.name}`;
    if (exists.length === 0) {
      if (!spec.password) {
        throw new Error(`Role ${spec.name} não existe e nenhuma senha foi informada para criá-lo.`);
      }
      await sql.unsafe(`CREATE ROLE ${spec.name} LOGIN`);
      log(`role criado: ${spec.name}`);
    }
    const attrs = `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE ${spec.bypass ? "BYPASSRLS" : "NOBYPASSRLS"}`;
    await sql.unsafe(`ALTER ROLE ${spec.name} WITH ${attrs}`);
    if (spec.password) {
      await sql.unsafe(`ALTER ROLE ${spec.name} WITH PASSWORD ${quoteLiteral(spec.password)}`);
    }
  }
}

async function applyMigrations(sql: postgres.Sql, dir: string, log: (m: string) => void) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version     text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const applied = new Map(
    (
      await sql<
        { version: string; checksum: string }[]
      >`select version, checksum from public.schema_migrations`
    ).map((r) => [r.version, r.checksum]),
  );
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const body = await readFile(path.join(dir, file), "utf8");
    const checksum = createHash("sha256").update(body).digest("hex");
    const previous = applied.get(version);
    if (previous) {
      if (previous !== checksum) {
        throw new Error(
          `Migration ${version} foi alterada depois de aplicada. Crie uma migration nova em vez de editar.`,
        );
      }
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public.schema_migrations (version, checksum) values (${version}, ${checksum})`;
    });
    log(`migration aplicada: ${version}`);
  }
}

async function applyGrants(sql: postgres.Sql) {
  const { app, worker, admin } = APP_ROLES;
  await sql.unsafe(`
    GRANT USAGE ON SCHEMA public TO ${app}, ${worker}, ${admin};
    GRANT USAGE ON SCHEMA ops TO ${app}, ${worker}, ${admin};

    -- Tabelas de domínio e de auth: CRUD; a RLS (FORCE) restringe as de domínio.
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${app}, ${worker}, ${admin};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${app}, ${worker}, ${admin};
    REVOKE INSERT, UPDATE, DELETE ON public.schema_migrations FROM ${app}, ${worker}, ${admin};
    -- audit_log é append-only para a aplicação.
    REVOKE UPDATE, DELETE ON public.audit_log FROM ${app}, ${worker};
    -- Modelos globais são somente leitura para a aplicação.
    REVOKE INSERT, UPDATE, DELETE ON public.category_templates FROM ${app}, ${worker};
    REVOKE INSERT, UPDATE, DELETE ON public.fiscal_parameters FROM ${app}, ${worker};
    REVOKE INSERT, UPDATE, DELETE ON public.trip_destination_templates FROM ${app}, ${worker};

    -- ops: web e worker registram deploys; worker registra heartbeat; leitura para a Ops API.
    GRANT SELECT ON ALL TABLES IN SCHEMA ops TO ${app}, ${worker}, ${admin};
    GRANT INSERT ON ops.deployments TO ${app}, ${worker};
    GRANT INSERT, UPDATE ON ops.agent_memory, ops.reports, ops.categorization_stats TO ${app};
    GRANT INSERT, UPDATE ON ops.worker_heartbeats TO ${worker};
    -- Agentes diários: só o worker registra rodadas; só a web registra acessos do painel.
    GRANT INSERT, UPDATE ON ops.agent_runs TO ${worker};
    GRANT INSERT ON ops.admin_access TO ${app};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ops TO ${app}, ${worker}, ${admin};
    GRANT ALL ON ALL TABLES IN SCHEMA ops TO ${admin};
  `);
}

async function installJobs(ownerUrl: string, sql: postgres.Sql, log: (m: string) => void) {
  const boss = new PgBoss({
    connectionString: ownerUrl,
    schema: PGBOSS_SCHEMA,
    supervise: false,
    schedule: false,
  });
  boss.on("error", (err) => log(`pg-boss (migrador): ${String(err)}`));
  await boss.start();
  try {
    for (const name of Object.values(JOB_QUEUES)) {
      const existing = await boss.getQueue(name);
      if (!existing) {
        await boss.createQueue(name);
        log(`fila criada: ${name}`);
      }
    }
  } finally {
    await boss.stop({ graceful: false });
  }
  const { app, worker } = APP_ROLES;
  await sql.unsafe(`
    GRANT USAGE ON SCHEMA ${PGBOSS_SCHEMA} TO ${app}, ${worker};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${PGBOSS_SCHEMA} TO ${app}, ${worker};
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${PGBOSS_SCHEMA} TO ${app}, ${worker};
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${PGBOSS_SCHEMA} TO ${app}, ${worker};
  `);
}

export async function migrate(opts: MigrateOptions): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(JSON.stringify({ level: "info", msg: m })));
  const sql = postgres(opts.ownerUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`select pg_advisory_lock(${LOCK_KEY})`;
    try {
      await ensureRoles(sql, opts, log);
      await applyMigrations(sql, opts.migrationsDir ?? defaultMigrationsDir(), log);
      await applyGrants(sql);
      if (opts.installJobs !== false) {
        await installJobs(opts.ownerUrl, sql, log);
      }
    } finally {
      await sql`select pg_advisory_unlock(${LOCK_KEY})`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Lê as opções do ambiente (usado pelo worker e pelo script `pnpm db:migrate`). */
export function migrateOptionsFromEnv(): MigrateOptions {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL;
  if (!ownerUrl) throw new Error("MIGRATION_DATABASE_URL não configurada.");
  return {
    ownerUrl,
    passwords: {
      app: process.env.OU_APP_DB_PASSWORD,
      worker: process.env.OU_WORKER_DB_PASSWORD,
      admin: process.env.OU_ADMIN_DB_PASSWORD,
    },
  };
}
