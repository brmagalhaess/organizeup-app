// Worker do OrganizeUp.
// 1) Se MIGRATION_DATABASE_URL existir, roda as migrações (credencial do dono, só aqui).
// 2) Conecta como ou_worker (DATABASE_URL), registra o deploy e processa filas do pg-boss.
import { hostname } from "node:os";
import { assistantConfigured } from "@organizeup/ai";
import { PgBoss } from "pg-boss";
import pino from "pino";
import {
  closeAllPools,
  collectPlatformStats,
  dailyAgentsKey,
  type DailyAgentsJob,
  hasAgentRunToday,
  JOB_QUEUES,
  PGBOSS_SCHEMA,
  readPlatformFlags,
  recordDeployment,
  recordWorkerHeartbeat,
} from "@organizeup/db";
import {
  MERCADO_AGENT,
  runBillingEvents,
  runBillingRenewals,
  runVipNotices,
} from "@organizeup/agents";
import { migrate, migrateOptionsFromEnv } from "@organizeup/db/migrator";
import { todayIn } from "@organizeup/domain";
import { dailyAgentsSentinel, runDailyAgents } from "./daily-agents";
import { reportingFailures, reportJobFailure } from "./diagnostics";
import { MARKET_SCHEDULES, maxCallsPerDay, runMarketDataJob } from "./market-data";
import { runInsightsJob } from "./insights";
import { snapshotNetWorth } from "./net-worth";

process.env.OU_PROCESS ??= "organizeup-worker";

const log = pino({ base: { service: "worker" } });
const commit = process.env.APP_COMMIT ?? "dev";
const workerId = `${hostname()}:${process.pid}`;
const dailyAgentsOn = process.env.DAILY_AGENTS_ENABLED !== "false";
/** O painel do serviço mostra se a chave existe, nunca o valor. O teto de chamadas não é segredo. */
const integrations = {
  dailyAgents: dailyAgentsOn,
  brapi: Boolean(process.env.BRAPI_TOKEN),
  brapiMaxCalls: maxCallsPerDay(),
  ai: assistantConfigured(),
};

async function main() {
  if (process.env.MIGRATION_DATABASE_URL && process.env.RUN_MIGRATIONS !== "false") {
    log.info("rodando migrações");
    await migrate({ ...migrateOptionsFromEnv(), log: (m) => log.info(m) });
    log.info("migrações concluídas");
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL não configurada.");

  await recordDeployment({ service: "worker", commit, hostname: hostname() });
  await recordWorkerHeartbeat({
    workerId,
    commit,
    info: { startedAt: new Date().toISOString(), ...integrations },
  });

  const boss = new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    migrate: false,
    createSchema: false,
    // Manutenção (arquivamento/limpeza) exige DDL; fica para o migrador/rotina dedicada.
    supervise: false,
  });
  boss.on("error", (err) => {
    log.error({ err }, "pg-boss");
    void reportJobFailure("pg-boss", err);
  });
  await boss.start();

  await boss.work(
    JOB_QUEUES.opsHeartbeat,
    reportingFailures(JOB_QUEUES.opsHeartbeat, async () => {
      await recordWorkerHeartbeat({
        workerId,
        commit,
        info: { lastJobAt: new Date().toISOString(), ...integrations },
      });
    }),
  );
  await boss.schedule(JOB_QUEUES.opsHeartbeat, "*/5 * * * *", null, { tz: "America/Sao_Paulo" });

  // Atualiza todo dia a foto do mês: a última de cada mês fica como o fechamento dele.
  // Em manutenção as famílias estão só leitura: a foto do mês espera a próxima rodada.
  await boss.work(
    JOB_QUEUES.netWorthSnapshot,
    reportingFailures(JOB_QUEUES.netWorthSnapshot, async () => {
      if ((await readPlatformFlags()).maintenance) return;
      await snapshotNetWorth(log);
    }),
  );
  await boss.schedule(JOB_QUEUES.netWorthSnapshot, "30 2 * * *", null, {
    tz: "America/Sao_Paulo",
  });
  await boss.send(JOB_QUEUES.netWorthSnapshot, null);

  // Contagens do painel do serviço: todo dia às 03:15 e no boot. Só soma; não depende dos agentes.
  await boss.work(
    JOB_QUEUES.platformStats,
    reportingFailures(JOB_QUEUES.platformStats, async () => {
      const day = todayIn();
      const counts = await collectPlatformStats(day, log);
      log.info({ day, households: counts.households }, "estatística da plataforma concluída");
    }),
  );
  await boss.schedule(JOB_QUEUES.platformStats, "15 3 * * *", null, { tz: "America/Sao_Paulo" });
  await boss.send(JOB_QUEUES.platformStats, null);

  // Stripe (ADR-0023): a web guarda o evento e avisa a fila; o minuto a minuto pega o que o aviso perdeu.
  // Fora do interruptor dos agentes: assinatura não pode parar junto com eles.
  await boss.work(
    JOB_QUEUES.billingEvents,
    reportingFailures(JOB_QUEUES.billingEvents, async () => {
      const result = await runBillingEvents(log);
      if (result.applied + result.waiting + result.closed + result.duplicates > 0) {
        log.info(result, "eventos da Stripe aplicados");
      }
    }),
  );
  await boss.schedule(JOB_QUEUES.billingEvents, "* * * * *", null, { tz: "America/Sao_Paulo" });
  await boss.work(
    JOB_QUEUES.billingRenewals,
    reportingFailures(JOB_QUEUES.billingRenewals, async () => {
      log.info({ sent: await runBillingRenewals(log) }, "avisos de renovação anual");
      log.info({ sent: await runVipNotices(log) }, "avisos de VIP acabando");
    }),
  );
  await boss.schedule(JOB_QUEUES.billingRenewals, "0 9 * * *", null, { tz: "America/Sao_Paulo" });

  // Agentes diários do produto (ADR-0015): acordados pelo Paperclip, às 05:30 se faltou algum e no
  // boot, se ainda não rodaram hoje.
  // DAILY_AGENTS_ENABLED=false desliga (e remove o agendamento que tenha ficado).
  // O mesmo interruptor para a coleta de mercado (ADR-0017), que roda antes deles.
  if (!dailyAgentsOn) {
    await boss.unschedule(JOB_QUEUES.dailyAgents);
    for (const { key } of MARKET_SCHEDULES) await boss.unschedule(JOB_QUEUES.marketData, key);
    log.info("agentes diários desligados (DAILY_AGENTS_ENABLED=false)");
  } else {
    await boss.work(
      JOB_QUEUES.marketData,
      reportingFailures(JOB_QUEUES.marketData, () => runMarketDataJob(log)),
    );
    for (const { key, cron } of MARKET_SCHEDULES) {
      await boss.schedule(JOB_QUEUES.marketData, cron, null, { tz: "America/Sao_Paulo", key });
    }
    await boss.work<DailyAgentsJob>(
      JOB_QUEUES.dailyAgents,
      reportingFailures(JOB_QUEUES.dailyAgents, ([job]) => runDailyAgents(log, job?.data ?? {})),
    );
    // O Paperclip acorda cada agente de madrugada. Este horário só pega quem ficou de fora.
    await boss.schedule(
      JOB_QUEUES.dailyAgents,
      "30 5 * * *",
      { missingOnly: true },
      { tz: "America/Sao_Paulo" },
    );
    // Dicas por tela: depois da rede de segurança das 05:30.
    await boss.work(
      JOB_QUEUES.aiInsights,
      reportingFailures(JOB_QUEUES.aiInsights, () => runInsightsJob(log)),
    );
    await boss.schedule(JOB_QUEUES.aiInsights, "45 5 * * *", null, { tz: "America/Sao_Paulo" });
    const today = todayIn();
    // Com chave, o boot atualiza já: quem acabou de colar o token não espera o próximo pregão.
    if (integrations.brapi || !(await hasAgentRunToday(today, MERCADO_AGENT))) {
      await boss.send(JOB_QUEUES.marketData, null, { singletonKey: `market:${today}` });
    }
    const sentinel = dailyAgentsSentinel((await readPlatformFlags()).disabledAgents);
    if (sentinel && !(await hasAgentRunToday(today, sentinel))) {
      await boss.send(JOB_QUEUES.dailyAgents, null, { singletonKey: dailyAgentsKey(today) });
    }
  }

  log.info({ commit, workerId, integrations }, "worker pronto");

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
