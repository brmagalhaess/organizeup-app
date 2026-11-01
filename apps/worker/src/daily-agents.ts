// Agentes diários do produto (ADR-0015): categorias, investimentos, aposentadoria, viagens e metas,
// para cada família ativa, cada agente na própria transação com RLS. A divisão do que sobra passa
// em memória do agente de aposentadoria para viagens e metas; se ele falhar, os dois leem o
// relatório de hoje ou pulam. Logs só com householdId, agente, código do erro e contagens.
import {
  hasAgentRunToday,
  householdTimezone,
  listActiveHouseholdIds,
  readPlatformFlags,
  recordAgentRun,
  withWorkerHousehold,
  type DailyAgentsJob,
  type TenantTx,
} from "@organizeup/db";
import { todayIn, type Allocation } from "@organizeup/domain";
import {
  APOSENTADORIA_AGENT,
  CATEGORIAS_AGENT,
  INVESTIMENTOS_AGENT,
  METAS_AGENT,
  runAposentadoriaAgent,
  runCategoriasAgent,
  runInvestimentosAgent,
  runMetasAgent,
  runViagensAgent,
  VIAGENS_AGENT,
  type AgentInput,
  type AgentResult,
} from "@organizeup/agents";
import { reportAgentFailure } from "./diagnostics";

interface Log {
  error: (data: object, message: string) => void;
  info: (data: object, message: string) => void;
}

/** Ordem de execução: a aposentadoria vem antes de viagens e metas, que usam a divisão dela. */
export const DAILY_AGENTS = [
  CATEGORIAS_AGENT,
  INVESTIMENTOS_AGENT,
  APOSENTADORIA_AGENT,
  VIAGENS_AGENT,
  METAS_AGENT,
] as const;

/** Agente cuja execução marca "a rodada de hoje aconteceu": o último ligado, ou nenhum. */
export const dailyAgentsSentinel = (disabled: string[]) =>
  DAILY_AGENTS.findLast((agent) => !disabled.includes(agent)) ?? null;

/** Famílias com sessão nos últimos N dias recebem a rodada. */
export const ACTIVE_DAYS = 60;

interface Counts {
  households: number;
  ok: number;
  failed: number;
  suggestions: number;
  applied: number;
}

const emptyCounts = (): Counts => ({ households: 0, ok: 0, failed: 0, suggestions: 0, applied: 0 });

/** Quem roda nesta chamada. O que o Paperclip não acordou, a rede de segurança das 05:30 pega. */
export async function agentsToRun(
  job: DailyAgentsJob,
  disabled: string[],
  day: string,
  ranToday: (day: string, agent: string) => Promise<boolean> = hasAgentRunToday,
): Promise<string[]> {
  const asked = DAILY_AGENTS.filter(
    (agent) => !disabled.includes(agent) && (!job.agents || job.agents.includes(agent)),
  );
  if (!job.missingOnly) return asked;
  const ran = await Promise.all(asked.map((agent) => ranToday(day, agent)));
  return asked.filter((_, index) => !ran[index]);
}

export async function runDailyAgents(log: Log, job: DailyAgentsJob = {}): Promise<void> {
  // Modo manutenção: as famílias estão só leitura, então o agente também não grava. Agente
  // desligado no painel não roda; viagens e metas seguem como quando a aposentadoria falha.
  const flags = await readPlatformFlags();
  if (flags.maintenance) {
    log.info({}, "agentes diários pulados: modo manutenção");
    return;
  }
  const startedAt = Date.now();
  const day = todayIn();
  const enabled = await agentsToRun(job, flags.disabledAgents, day);
  if (enabled.length === 0) return;
  const ids = await listActiveHouseholdIds(ACTIVE_DAYS);
  const counts = new Map<string, Counts>(enabled.map((agent) => [agent, emptyCounts()]));

  for (const householdId of ids) {
    let today = day;
    try {
      today = await withWorkerHousehold(householdId, async (tx) =>
        todayIn(await householdTimezone(tx, householdId)),
      );
    } catch (err) {
      log.error({ householdId, code: codeOf(err) }, "agentes diários: fuso da família falhou");
      await reportAgentFailure("fuso", err);
    }
    const input: AgentInput = { today, householdId };
    let allocation: Allocation | undefined;

    const run = async (
      agent: string,
      fn: (tx: TenantTx) => Promise<AgentResult>,
    ): Promise<AgentResult | null> => {
      const count = counts.get(agent);
      if (!count) return null;
      count.households += 1;
      try {
        const result = await withWorkerHousehold(householdId, fn);
        count.ok += 1;
        count.suggestions += result.suggestions;
        count.applied += result.applied;
        return result;
      } catch (err) {
        // Sem a mensagem do erro: ela pode trazer valores da família.
        count.failed += 1;
        log.error({ householdId, agent, code: codeOf(err) }, "agente diário falhou");
        await reportAgentFailure(agent, err);
        return null;
      }
    };

    await run(CATEGORIAS_AGENT, (tx) => runCategoriasAgent(tx, input));
    await run(INVESTIMENTOS_AGENT, (tx) => runInvestimentosAgent(tx, input));
    const retirement = await run(APOSENTADORIA_AGENT, async (tx) => {
      const result = await runAposentadoriaAgent(tx, input);
      allocation = result.allocation;
      return result;
    });
    if (!retirement) allocation = undefined;
    const withAllocation: AgentInput = allocation ? { ...input, allocation } : input;
    await run(VIAGENS_AGENT, (tx) => runViagensAgent(tx, withAllocation));
    await run(METAS_AGENT, (tx) => runMetasAgent(tx, withAllocation));
  }

  const durationMs = Date.now() - startedAt;
  for (const agent of enabled) {
    const count = counts.get(agent)!;
    try {
      await recordAgentRun(day, agent, { ...count, durationMs });
    } catch (err) {
      log.error({ agent, code: codeOf(err) }, "registro da rodada falhou");
    }
    log.info({ agent, ...count }, "agente diário concluído");
  }
  log.info({ day, households: ids.length, durationMs }, "agentes diários concluídos");
}

const codeOf = (err: unknown) => (err as { code?: string }).code;
