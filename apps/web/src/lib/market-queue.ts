// Pede ao worker uma rodada de coleta de mercado agora (ADR-0017): a web não chama a fonte, só enfileira.
// A conexão abre no clique e fecha em seguida. Falhar aqui não perde nada: a rodada das 17:00 cobre.
import "server-only";
import { JOB_QUEUES, PGBOSS_SCHEMA } from "@organizeup/db";
import { reportActionFailure } from "@/lib/diagnostics";

/** Uma rodada pedida pela tela vale por meia hora: cliques repetidos não gastam cota da fonte. */
const ON_DEMAND_WINDOW_SECONDS = 30 * 60;

export async function queueMarketDataJob(): Promise<boolean> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return false;
  try {
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
    boss.on("error", (error) => reportActionFailure("market_queue_failed", error));
    await boss.start();
    try {
      await boss.send(
        JOB_QUEUES.marketData,
        { mode: "full" },
        { singletonKey: "market:on-demand", singletonSeconds: ON_DEMAND_WINDOW_SECONDS },
      );
    } finally {
      await boss.stop({ graceful: false });
    }
    return true;
  } catch (error) {
    reportActionFailure("market_queue_failed", error);
    return false;
  }
}
