// Registra o consumo. O custo vem do `usage` da resposta. Só contagens: nada de texto.
import {
  aiUsage,
  recordAiStats,
  sql,
  withHousehold,
  type AiUsageCounts,
  type TenantContext,
} from "@organizeup/db";
import { costUsd, type ModelUsage } from "./models";

const usd = (value: number) => value.toFixed(6);

/** Grava na família e soma no serviço. Falhar aqui encerra o turno: sem registro, o teto não vale. */
export async function recordUsage(
  ctx: TenantContext,
  route: string,
  day: string,
  usages: ModelUsage[],
): Promise<void> {
  if (usages.length === 0) return;
  await withHousehold(ctx, async (tx) => {
    for (const usage of usages) {
      await tx
        .insert(aiUsage)
        .values({
          householdId: ctx.householdId,
          day,
          route,
          model: usage.model,
          calls: 1,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          costUsd: usd(costUsd(usage)),
        })
        .onConflictDoUpdate({
          target: [aiUsage.householdId, aiUsage.day, aiUsage.route, aiUsage.model],
          set: {
            calls: sql`${aiUsage.calls} + 1`,
            inputTokens: sql`${aiUsage.inputTokens} + excluded.input_tokens`,
            outputTokens: sql`${aiUsage.outputTokens} + excluded.output_tokens`,
            cacheReadTokens: sql`${aiUsage.cacheReadTokens} + excluded.cache_read_tokens`,
            cacheWriteTokens: sql`${aiUsage.cacheWriteTokens} + excluded.cache_write_tokens`,
            costUsd: sql`${aiUsage.costUsd} + excluded.cost_usd`,
            updatedAt: sql`now()`,
          },
        });
    }
  });
  await recordServiceUsage(day, route, usages);
}

/** Soma no serviço: é o que o teto mensal lê. */
export async function recordServiceUsage(
  day: string,
  route: string,
  usages: ModelUsage[],
): Promise<void> {
  const totals = usages.reduce<AiUsageCounts>(
    (acc, usage) => ({
      calls: acc.calls + 1,
      inputTokens: acc.inputTokens + usage.inputTokens,
      outputTokens: acc.outputTokens + usage.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + usage.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + usage.cacheWriteTokens,
      costUsd: usd(Number(acc.costUsd) + costUsd(usage)),
    }),
    {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: "0",
    },
  );
  await recordAiStats(day, route, totals);
}
