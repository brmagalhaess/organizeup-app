// Parágrafo "O que mudou" dos relatórios fechados (ADR-0021). Roda dentro da rodada diária, família a
// família, logo depois do agente `relatorios`, sem transação aberta durante a chamada ao modelo.
import {
  assistantConfigured,
  createModelClient,
  runStatementNarration,
  type StatementNarrationRun,
} from "@organizeup/ai";
import { fromJob, type PlatformFlags } from "@organizeup/db";

/** Null: esta rodada não chama o modelo. */
export type StatementNarrator = (
  householdId: string,
  day: string,
) => Promise<StatementNarrationRun | null>;

export function statementNarrator(flags: PlatformFlags): StatementNarrator | null {
  if (!assistantConfigured() || !flags.aiEnabled) return null;
  const client = createModelClient();
  let ceiling = false;
  return async (householdId, day) => {
    if (ceiling) return null;
    const run = await runStatementNarration({ ctx: fromJob({ householdId }), client, day });
    ceiling = run.gate === "teto_mensal";
    return run;
  };
}
