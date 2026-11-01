// Verificador determinístico da rotina da madrugada (§5.3). Roda depois do modelo e antes de gravar:
// reprovou, a dica é descartada. Nada aqui lê banco nem chama o modelo.
import type { PrivacyFilter } from "../privacy";
import { uncheckedAmounts } from "../verify";

export type InsightRejection = "numero" | "ativo" | "recomendacao" | "nome" | "instrucao";

const TICKER = /\b[A-Z]{4}\d{1,2}\b/;
const ASSET_ORDER =
  /\b(compre|comprar|venda|vender|mantenha|manter|invista|investir|troque|resgate|resgatar)\b[^.!?]{0,60}\b(ações|ação|fundos?|fiis?|etfs?|bdrs?|cdbs?|lcis?|lcas?|tesouro|cripto\w*|bitcoin)\b/i;
/** Texto que tenta mandar no modelo. Vale também para o que vira memória da família. */
export const INSTRUCTION = /https?:|www\.|<|\b(ignore|ignorar|instruções|system prompt)\b/i;
const PERCENT = /(\d+(?:[.,]\d+)?)\s?%/g;

function uncheckedPercents(text: string, known: number[]): boolean {
  return [...text.matchAll(PERCENT)].some((match) => {
    const value = Number(match[1]!.replace(",", "."));
    return !known.some((item) => Math.abs(item - value) <= 0.5);
  });
}

export function rejectionOf(
  text: string,
  known: number[],
  privacy: PrivacyFilter,
): InsightRejection | null {
  if (uncheckedAmounts(text, known).length > 0 || uncheckedPercents(text, known)) return "numero";
  if (TICKER.test(text)) return "ativo";
  if (ASSET_ORDER.test(text)) return "recomendacao";
  if (privacy.scrub(text) !== text) return "nome";
  if (INSTRUCTION.test(text)) return "instrucao";
  return null;
}
