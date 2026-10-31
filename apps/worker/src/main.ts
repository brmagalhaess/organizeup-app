// Worker do OrganizeUp.
// 1) Se MIGRATION_DATABASE_URL existir, roda as migrações (credencial do dono, só aqui).
// 2) Conecta como ou_worker (DATABASE_URL), registra o deploy e processa filas do pg-boss.
import { hostname } from "node:os";
import { PgBoss } from "pg-boss";
import pino from "pino";
import {
  closeAllPools,
  hasAgentRunToday,
  JOB_QUEUES,
  PGBOSS_SCHEMA,
  recordDeployment,
  recordWorkerHeartbeat,
} from "@organizeup/db";
import { MERCADO_AGENT } from "@organizeup/agents";
import { migrate, migrateOptionsFromEnv } from "@organizeup/db/migrator";
import { todayIn } from "@organizeup/domain";
import { DAILY_AGENTS_SENTINEL, runDailyAgents } from "./daily-agents";
import { MARKET_SCHEDULES, runMarketDataJob } from "./market-data";
import { snapshotNetWorth } from "./net-worth";

process.env.OU_PROCESS ??= "organizeup-worker";

const log = pino({ base: { service: "worker" } });
const commit = process.env.APP_COMMIT ?? "dev";
const workerId = `${hostname()}:${process.pid}`;

async function main() {
  if (process.env.MIGRATION_DATABASE_URL && process.env.RUN_MIGRATIONS !== "false") {
    log.info("rodando migrações");
    await migrate({ ...migrateOptionsFromEnv(), log: (m) => log.info(m) });
    log.info("migrações concluídas");
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL não configurada.");

  await recordDeployment({ service: "worker", commit, hostname: hostname() });
  await recordWorkerHeartbeat({ workerId, commit, info: { startedAt: new Date().toISOString() } });

  const boss = new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    migrate: false,
    createSchema: false,
    // Manutenção (arquivamento/limpeza) exige DDL; fica para o migrador/rotina dedicada.
    supervise: false,
  });
  boss.on("error", (err) => log.error({ err }, "pg-boss"));
  await boss.start();

  await boss.work(JOB_QUEUES.opsHeartbeat, async () => {
    await recordWorkerHeartbeat({
      workerId,
      commit,
      info: { lastJobAt: new Date().toISOString() },
    });
  });
  await boss.schedule(JOB_QUEUES.opsHeartbeat, "*/5 * * * *", null, { tz: "America/Sao_Paulo" });

  // Atualiza todo dia a foto do mês: a última de cada mês fica como o fechamento dele.
  await boss.work(JOB_QUEUES.netWorthSnapshot, () => snapshotNetWorth(log));
  await boss.schedule(JOB_QUEUES.netWorthSnapshot, "30 2 * * *", null, {
    tz: "America/Sao_Paulo",
  });
  await boss.send(JOB_QUEUES.netWorthSnapshot, null);

  // Agentes diários do produto (ADR-0015): todo dia às 04:00 e no boot, se ainda não rodaram hoje.
  // DAILY_AGENTS_ENABLED=false desliga (e remove o agendamento que tenha ficado).
  // O mesmo interruptor para a coleta de mercado (ADR-0017), que roda antes deles.
  if (process.env.DAILY_AGENTS_ENABLED === "false") {
    await boss.unschedule(JOB_QUEUES.dailyAgents);
    for (const { key } of MARKET_SCHEDULES) await boss.unschedule(JOB_QUEUES.marketData, key);
    log.info("agentes diários desligados (DAILY_AGENTS_ENABLED=false)");
  } else {
    await boss.work(JOB_QUEUES.marketData, () => runMarketDataJob(log));
    for (const { key, cron } of MARKET_SCHEDULES) {
      await boss.schedule(JOB_QUEUES.marketData, cron, null, { tz: "America/Sao_Paulo", key });
    }
    await boss.work(JOB_QUEUES.dailyAgents, () => runDailyAgents(log));
    await boss.schedule(JOB_QUEUES.dailyAgents, "0 4 * * *", null, { tz: "America/Sao_Paulo" });
    const today = todayIn();
    if (!(await hasAgentRunToday(today, MERCADO_AGENT))) {
      await boss.send(JOB_QUEUES.marketData, null, { singletonKey: `market:${today}` });
    }
    if (!(await hasAgentRunToday(today, DAILY_AGENTS_SENTINEL))) {
      await boss.send(JOB_QUEUES.dailyAgents, null, { singletonKey: `daily:${today}` });
    }
  }

  log.info({ commit, workerId }, "worker pronto");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "encerrando");
    try {
      await boss.stop({ graceful: true, timeout: 20_000 });
      await closeAllPools();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch(async (err) => {
  log.fatal({ err }, "falha ao iniciar o worker");
  await closeAllPools().catch(() => {});
  process.exit(1);
});
