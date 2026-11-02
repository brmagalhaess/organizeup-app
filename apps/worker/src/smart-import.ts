// Job `smart-import` (ADR-0030): o agente `importador`, por pedido da família. Um lote por job, um arquivo por
// vez. Sem `importId`, é a limpeza diária dos lotes vencidos. Fora de `DAILY_AGENTS_ENABLED`: a família está
// esperando. Logs só com id da família, código do erro e contagens.
import { assistantConfigured, createModelClient } from "@organizeup/ai";
import { runSmartImport } from "@organizeup/ai/importador";
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

/** Família apagada no meio: a FK recusa, e repetir só recusaria de novo. */
function householdGone(err: unknown): boolean {
  const { code, cause } = err as { code?: string; cause?: { code?: string } };
  return code === "23503" || cause?.code === "23503";
}

export async function runSmartImportJob(
  log: Log,
  job: SmartImportJob,
  requeue: (job: SmartImportJob) => Promise<unknown> = async () => undefined,
): Promise<void> {
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
      // Um arquivo por vez e volta para o fim da fila: um lote grande não segura as outras famílias.
      maxFiles: 1,
    });
    if (!run) return;
    const before = job.tally;
    const tally = {
      files: run.files + (before?.files ?? 0),
      byRules: run.byRules + (before?.byRules ?? 0),
      byModel: run.byModel + (before?.byModel ?? 0),
      failed: run.failed + (before?.failed ?? 0),
    };
    if (run.remaining) {
      await requeue({ householdId, importId, tally });
      return;
    }
    const durationMs = Date.now() - startedAt;
    await recordAgentRun(todayIn(), IMPORTADOR_AGENT, {
      households: 1,
      ok: tally.files - tally.failed,
      failed: tally.failed,
      suggestions: tally.byModel,
      applied: tally.byRules,
      durationMs,
    });
    log.info({ householdId, ...tally, durationMs }, "lote lido");
  } catch (err) {
    if (householdGone(err)) {
      log.info({ householdId }, "família apagada durante a leitura");
      return;
    }
    log.error({ householdId, code: (err as { code?: string }).code }, "importador falhou");
    await reportAgentFailure(IMPORTADOR_AGENT, err);
    throw err;
  }
}
