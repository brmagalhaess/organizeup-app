// Job `ai-insights`: dicas por tela, uma família por vez, depois dos agentes de regras (§5). Falha de
// uma família não para as outras. Logs só com id da família, código do erro e contagens.
import { assistantConfigured, createModelClient, runNightlyInsights } from "@organizeup/ai";
import {
  fromJob,
  hasAgentRunToday,
  listActiveHouseholdIds,
  readPlatformFlags,
  recordAgentDiscards,
  recordAgentRun,
} from "@organizeup/db";
import { todayIn } from "@organizeup/domain";
import { ACTIVE_DAYS } from "./daily-agents";
import { reportAgentFailure } from "./diagnostics";

export const INSIGHTS_AGENT = "dicas";

interface Log {
  error: (data: object, message: string) => void;
  info: (data: object, message: string) => void;
}

export async function runInsightsJob(log: Log): Promise<void> {
  if (!assistantConfigured()) {
    log.info({}, "dicas puladas: sem chave da IA no worker");
    return;
  }
  const flags = await readPlatformFlags();
  if (flags.maintenance || !flags.aiEnabled || flags.disabledAgents.includes(INSIGHTS_AGENT)) {
    log.info({}, "dicas puladas: desligadas no painel");
    return;
  }
  const startedAt = Date.now();
  const day = todayIn();
  const ids = await listActiveHouseholdIds(ACTIVE_DAYS);
  const client = createModelClient();
  const counts = { households: 0, ok: 0, failed: 0, suggestions: 0, applied: 0 };
  let discarded = 0;

  for (const householdId of ids) {
    try {
      const run = await runNightlyInsights({ ctx: fromJob({ householdId }), client, day });
      if (run.gate === "teto_mensal") break;
      if (run.gate !== "pronto") continue;
      counts.households += 1;
      counts.ok += 1;
      counts.suggestions += run.created;
      discarded += run.discarded;
    } catch (err) {
      counts.households += 1;
      counts.failed += 1;
      log.error({ householdId, code: (err as { code?: string }).code }, "dicas falharam");
      await reportAgentFailure(INSIGHTS_AGENT, err);
    }
  }
  const durationMs = Date.now() - startedAt;
  if (discarded > 0) await recordAgentDiscards(day, INSIGHTS_AGENT, discarded);
  // Pedir de novo no mesmo dia pula quem já recebeu dicas: sem ninguém atendido, a rodada do dia vale.
  if (counts.households > 0 || !(await hasAgentRunToday(day, INSIGHTS_AGENT))) {
    await recordAgentRun(day, INSIGHTS_AGENT, { ...counts, durationMs });
  }
  log.info({ ...counts, discarded, durationMs }, "dicas concluídas");
}
