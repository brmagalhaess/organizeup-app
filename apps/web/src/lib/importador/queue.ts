// Avisa o worker que há lote para ler. A conexão abre só no clique e fecha em seguida. Falhar aqui não perde
// nada: o lote fica na fila no banco, e a própria tela pede de novo depois de um tempo parada (ADR-0030).
import "server-only";
import { JOB_QUEUES, PGBOSS_SCHEMA, smartImportKey, type SmartImportJob } from "@organizeup/db";
import { reportActionFailure } from "@/lib/diagnostics";

export async function queueSmartImportJob(job: Required<SmartImportJob>): Promise<boolean> {
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
    boss.on("error", (error) => reportActionFailure("smart_import_failed", error));
    await boss.start();
    try {
      await boss.send(JOB_QUEUES.smartImport, job, {
        singletonKey: smartImportKey(job.importId),
        singletonSeconds: 30,
        retryLimit: 2,
        retryDelay: 30,
      });
    } finally {
      await boss.stop({ graceful: false });
    }
    return true;
  } catch (error) {
    reportActionFailure("smart_import_failed", error);
    return false;
  }
}
