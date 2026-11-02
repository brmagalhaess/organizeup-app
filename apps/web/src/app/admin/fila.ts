// Enfileira trabalho para o worker pelo pg-boss. A conexão abre só no clique, e fecha em seguida: o
// painel é de uso raro e não processa fila nenhuma.
import "server-only";
import { agentWakeKey, dailyAgentsKey, JOB_QUEUES, PGBOSS_SCHEMA } from "@organizeup/db";
import { todayIn } from "@organizeup/domain";
import type { PgBoss } from "pg-boss";
import { DICAS_AGENT, MERCADO_AGENT } from "./agentes/catalogo";
import { logAdminFailure } from "./painel";

export { DICAS_AGENT, MERCADO_AGENT };

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

/** Um agente só, a pedido do Paperclip. O worker confere manutenção e interruptor do painel. */
export function queueAgent(agent: string) {
  const singletonKey = agentWakeKey(todayIn(), agent);
  return withBoss((boss) =>
    agent === MERCADO_AGENT || agent === DICAS_AGENT
      ? boss.send(agent === DICAS_AGENT ? JOB_QUEUES.aiInsights : JOB_QUEUES.marketData, null, {
          singletonKey,
          singletonSeconds: SINGLETON_SECONDS,
        })
      : boss.send(
          JOB_QUEUES.dailyAgents,
          { agents: [agent] },
          { singletonKey, singletonSeconds: SINGLETON_SECONDS },
        ),
  );
}

/** Evento da Stripe guardado: acorda o worker sem esperar a passada do minuto. */
export function queueBillingEvents() {
  return withBoss((boss) =>
    boss.send(JOB_QUEUES.billingEvents, null, {
      singletonKey: "billing-events",
      singletonSeconds: 5,
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
