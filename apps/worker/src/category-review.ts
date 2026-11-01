// Etapa de IA do agente de categorias (ADR-0018). Roda dentro da rodada diária, família a família,
// entre as regras e a aposentadoria: a projeção precisa dos gastos já arrumados, e uma fila própria
// não garantiria essa ordem. Sem transação aberta durante a chamada ao modelo.
import {
  assistantConfigured,
  createModelClient,
  runCategoryReview,
  type CategoryReviewRun,
} from "@organizeup/ai";
import { fromJob, type PlatformFlags } from "@organizeup/db";

/** Null: esta rodada não chama o modelo. A função devolve null para família que não passou no portão. */
export type CategoryReviewer = (
  householdId: string,
  day: string,
) => Promise<CategoryReviewRun | null>;

export function categoryReviewer(flags: PlatformFlags): CategoryReviewer | null {
  if (!assistantConfigured() || !flags.aiEnabled) return null;
  const client = createModelClient();
  let ceiling = false;
  return async (householdId, day) => {
    if (ceiling) return null;
    const run = await runCategoryReview({ ctx: fromJob({ householdId }), client, day });
    ceiling = run.gate === "teto_mensal";
    return run.gate === "pronto" ? run : null;
  };
}
