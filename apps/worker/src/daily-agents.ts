// Agentes diários do produto (ADR-0015): categorias, categorias com IA (ADR-0018), investimentos,
// dívidas (ADR-0019), aposentadoria, viagens, metas e relatórios (ADR-0021), para cada família ativa,
// cada agente na própria transação com RLS, e a chamada ao modelo fora de qualquer transação. A divisão do que sobra passa
// em memória do agente de aposentadoria para viagens e metas; se ele falhar, os dois leem o
// relatório de hoje ou pulam. Logs só com householdId, agente, código do erro e contagens.
import {
  fromJob,
  hasAgentRunToday,
  householdTimezone,
  listActiveHouseholdIds,
  readFamilyAccess,
  readPlatformFlags,
  recordAgentRun,
  withWorkerHousehold,
  type DailyAgentsJob,
  type TenantTx,
} from "@organizeup/db";
import {
  todayIn,
  TRIP_INTENTIONS_RUN,
  type Allocation,
  type FamilyAccess,
} from "@organizeup/domain";
import {
  agentMayRun,
  APOSENTADORIA_AGENT,
  CATEGORIAS_AGENT,
  CATEGORIAS_IA_AGENT,
  currentAllocation,
  DIVIDAS_AGENT,
  INVESTIMENTOS_AGENT,
  METAS_AGENT,
  RELATORIOS_AGENT,
  runAposentadoriaAgent,
  runCategoriasAgent,
  runDividasAgent,
  runInvestimentosAgent,
  runMetasAgent,
  runRelatoriosAgent,
  runViagensAgent,
  VIAGENS_AGENT,
  type AgentInput,
  type AgentResult,
} from "@organizeup/agents";
import { categoryReviewer } from "./category-review";
import { reportAgentFailure } from "./diagnostics";
import { statementNarrator } from "./statement-narration";

interface Log {
  error: (data: object, message: string) => void;
  info: (data: object, message: string) => void;
}

/**
 * Ordem de execução: dívidas vem antes da aposentadoria, que usa a dívida cara; a aposentadoria vem
 * antes de viagens e metas, que usam a divisão dela, e depois das categorias, porque a projeção usa
 * os gastos. Relatórios vêm por último: leem o que todos os outros deixaram.
 */
export const DAILY_AGENTS = [
  CATEGORIAS_AGENT,
  CATEGORIAS_IA_AGENT,
  INVESTIMENTOS_AGENT,
  DIVIDAS_AGENT,
  APOSENTADORIA_AGENT,
  VIAGENS_AGENT,
  METAS_AGENT,
  RELATORIOS_AGENT,
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
  // O Paperclip acorda "categorias"; a etapa de IA anda junto, antes de ele acordar a aposentadoria.
  const wanted = job.agents?.includes(CATEGORIAS_AGENT)
    ? [...job.agents, CATEGORIAS_IA_AGENT]
    : job.agents;
  const asked = DAILY_AGENTS.filter(
    (agent) => !disabled.includes(agent) && (!wanted || wanted.includes(agent)),
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
  const reviewCount = counts.get(CATEGORIAS_IA_AGENT);
  const review = reviewCount ? categoryReviewer(flags) : null;
  const statementCount = counts.get(RELATORIOS_AGENT);
  const intentionsCount = emptyCounts();
  const narrate = statementCount ? statementNarrator(flags) : null;

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

    // Agente de módulo desligado não roda, e em só leitura nenhum roda (ADR-0023).
    let access: FamilyAccess;
    try {
      access = await readFamilyAccess(fromJob({ householdId }), flags);
    } catch (err) {
      log.error({ householdId, code: codeOf(err) }, "agentes diários: plano da família falhou");
      await reportAgentFailure("plano", err);
      continue;
    }

    const run = async <R extends Pick<AgentResult, "suggestions" | "applied">>(
      agent: string,
      fn: (tx: TenantTx) => Promise<R>,
    ): Promise<R | null> => {
      const count = counts.get(agent);
      if (!count || !agentMayRun(agent, access)) return null;
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
    if (review && reviewCount && agentMayRun(CATEGORIAS_IA_AGENT, access)) {
      // Fora de `run`: a chamada ao modelo não pode ficar dentro de uma transação.
      try {
        const result = await review(householdId, day);
        if (result) {
          reviewCount.households += 1;
          reviewCount.ok += 1;
          reviewCount.applied += result.moved;
        }
      } catch (err) {
        reviewCount.households += 1;
        reviewCount.failed += 1;
        log.error(
          { householdId, agent: CATEGORIAS_IA_AGENT, code: codeOf(err) },
          "agente diário falhou",
        );
        await reportAgentFailure(CATEGORIAS_IA_AGENT, err);
      }
    }
    await run(INVESTIMENTOS_AGENT, (tx) => runInvestimentosAgent(tx, input));
    await run(DIVIDAS_AGENT, (tx) => runDividasAgent(tx, input));
    const retirement = await run(APOSENTADORIA_AGENT, async (tx) => {
      const result = await runAposentadoriaAgent(tx, input);
      allocation = result.allocation;
      return result;
    });
    if (!retirement) allocation = undefined;
    // Metas e viagens precisam da divisão mesmo em quem não tem Aposentadoria: só leitura, sem relatório.
    // Vale para quem foi acordado: o Paperclip chama viagens e metas separados.
    const planning =
      (agentMayRun(METAS_AGENT, access) && counts.has(METAS_AGENT)) ||
      (agentMayRun(VIAGENS_AGENT, access) && counts.has(VIAGENS_AGENT));
    if (!allocation && planning && !agentMayRun(APOSENTADORIA_AGENT, access)) {
      try {
        allocation = await withWorkerHousehold(householdId, (tx) => currentAllocation(tx, today));
      } catch (err) {
        log.error({ householdId, code: codeOf(err) }, "agentes diários: divisão falhou");
        await reportAgentFailure("divisao", err);
      }
    }
    const withAllocation: AgentInput = allocation ? { ...input, allocation } : input;
    const viagens = await run(VIAGENS_AGENT, (tx) => runViagensAgent(tx, withAllocation));
    if (viagens && viagens.intentions.total > 0) {
      intentionsCount.households += 1;
      intentionsCount.ok += 1;
      intentionsCount.suggestions += viagens.intentions.used;
    }
    await run(METAS_AGENT, (tx) => runMetasAgent(tx, withAllocation));
    const statements = await run(RELATORIOS_AGENT, (tx) => runRelatoriosAgent(tx, input));
    if (statements && narrate && statementCount) {
      // Fora de `run`: a chamada ao modelo não pode ficar dentro de uma transação. Falha aqui não
      // desfaz o relatório, que sai igual, sem o parágrafo.
      try {
        await narrate(householdId, day);
      } catch (err) {
        statementCount.failed += 1;
        log.error(
          { householdId, agent: RELATORIOS_AGENT, code: codeOf(err) },
          "agente diário falhou",
        );
        await reportAgentFailure(RELATORIOS_AGENT, err);
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  if (intentionsCount.households > 0) {
    try {
      await recordAgentRun(day, TRIP_INTENTIONS_RUN, { ...intentionsCount, durationMs });
    } catch (err) {
      log.error({ agent: TRIP_INTENTIONS_RUN, code: codeOf(err) }, "registro da rodada falhou");
    }
  }
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

/** O Drizzle embrulha o erro do Postgres: o código fica em `cause`. */
const codeOf = (err: unknown) => {
  const { code, cause } = err as { code?: string; cause?: { code?: string } };
  return code ?? cause?.code;
};
