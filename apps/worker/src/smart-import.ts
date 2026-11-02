// Job `smart-import` (ADR-0030): o agente `importador`, por pedido da família. Um lote por job, um arquivo por
// vez. Sem `importId`, é a limpeza diária dos lotes vencidos. Fora de `DAILY_AGENTS_ENABLED`: a família está
// esperando. Logs só com id da família, código do erro e contagens.
import { assistantConfigured, createModelClient, runSmartImport } from "@organizeup/ai";
import { IMPORTADOR_AGENT, purgeSmartImports } from "@organizeup/agents";
import {
  fromJob,
  listHouseholdIds,
  readPlatformFlags,
  recordAgentRun,
  withWorkerHousehold,
  type SmartImportJob,
} from "@organizeup/db";
import { todayIn } from "@organizeup/domain";
import { reportAgentFailure } from "./diagnostics";

interface Log {
  error: (data: object, message: string) => void;
  info: (data: object, message: string) => void;
}

async function purgeExpired(log: Log) {
  let removed = 0;
  for (const householdId of await listHouseholdIds()) {
    try {
      removed += await withWorkerHousehold(householdId, (tx) => purgeSmartImports(tx));
    } catch (err) {
      log.error({ householdId, code: (err as { code?: string }).code }, "limpeza falhou");
      await reportAgentFailure(IMPORTADOR_AGENT, err);
    }
  }
  log.info({ removed }, "lotes vencidos apagados");
}

export async function runSmartImportJob(log: Log, job: SmartImportJob): Promise<void> {
  if (!job.importId || !job.householdId) return purgeExpired(log);
  // Em manutenção a família só lê: a tela pede de novo depois.
  if ((await readPlatformFlags()).maintenance) return;
  const startedAt = Date.now();
  const { householdId, importId } = job;
  try {
    const run = await runSmartImport({
      ctx: fromJob({ householdId }),
      client: assistantConfigured() ? createModelClient() : null,
      importId,
    });
    if (!run) return;
    const durationMs = Date.now() - startedAt;
    await recordAgentRun(todayIn(), IMPORTADOR_AGENT, {
      households: 1,
      ok: run.files - run.failed,
      failed: run.failed,
      suggestions: run.byModel,
      applied: run.byRules,
      durationMs,
    });
    log.info({ householdId, ...run, durationMs }, "lote lido");
  } catch (err) {
    log.error({ householdId, code: (err as { code?: string }).code }, "importador falhou");
    await reportAgentFailure(IMPORTADOR_AGENT, err);
    throw err;
  }
}
