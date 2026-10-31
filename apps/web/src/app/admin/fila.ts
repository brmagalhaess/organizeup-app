// Enfileira trabalho para o worker pelo pg-boss. A conexão abre só no clique, e fecha em seguida: o
// painel é de uso raro e não processa fila nenhuma.
import "server-only";
import { dailyAgentsKey, JOB_QUEUES, PGBOSS_SCHEMA } from "@organizeup/db";
import { todayIn } from "@organizeup/domain";
import type { PgBoss } from "pg-boss";
import { logAdminFailure } from "./painel";

/**
 * Janela em que um segundo pedido com a mesma chave é ignorado. Numa fila `standard` a chave sozinha
 * não impede duplicata: quem impede é o par chave + janela.
 */
const SINGLETON_SECONDS = 300;

async function withBoss<T>(fn: (boss: PgBoss) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL não configurada.");
  const { PgBoss } = await import("pg-boss");
  const boss = new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
    max: 2,
  });
  boss.on("error", (error) => logAdminFailure("admin_pgboss_failed", error));
  await boss.start();
  try {
    return await fn(boss);
  } finally {
    await boss.stop({ graceful: false });
  }
}

/** Null quando já existe pedido igual dentro da janela. */
export function queueDailyAgents() {
  return withBoss((boss) =>
    boss.send(JOB_QUEUES.dailyAgents, null, {
      singletonKey: dailyAgentsKey(todayIn()),
      singletonSeconds: SINGLETON_SECONDS,
    }),
  );
}

export function queuePlatformStats() {
  return withBoss((boss) =>
    boss.send(JOB_QUEUES.platformStats, null, {
      singletonKey: `stats:${todayIn()}`,
      singletonSeconds: SINGLETON_SECONDS,
    }),
  );
}
