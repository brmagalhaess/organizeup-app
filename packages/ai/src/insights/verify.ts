// Verificador determinístico da rotina da madrugada (§5.3). Roda depois do modelo e antes de gravar:
// reprovou, a dica é descartada. Nada aqui lê banco nem chama o modelo.
import type { PrivacyFilter } from "../privacy";
import { parseNumber, uncheckedAmounts } from "../verify";

export type InsightRejection = "numero" | "ativo" | "recomendacao" | "nome" | "instrucao";

const TICKER = /\b[A-Z]{4}\d{1,2}\b/;
const ASSET_ORDERS = [
  /\b(compre|comprar|venda|vender|mantenha|manter|invista|investir|troque|resgate|resgatar)\b[^.!?]{0,60}\b(ações|ação|fundos?|fiis?|etfs?|bdrs?|cdbs?|lcis?|lcas?|tesouro|cripto\w*|bitcoin)\b/i,
  // A reserva de emergência é "emergency fund" e "fondo de emergencia": não é ativo.
  /\b(buy|buying|sell|selling|hold|holding|keep|keeping|invest|investing|swap|switch|redeem|redeeming)\b[^.!?]{0,60}\b(stocks?|shares?|(?<!emergency )funds?|fiis?|reits?|etfs?|bdrs?|cdbs?|lcis?|lcas?|treasury|treasuries|bonds?|crypto\w*|bitcoin)\b/i,
  /\b(compra|comprar|compre|vende|vender|venda|mantén|mantener|mantenga|conserva|conservar|invierte|invertir|invierta|cambia|cambiar|rescata|rescatar)\b[^.!?]{0,60}\b(acciones|acción|fondos?(?! de (?:emergencia|reserva))|fiis?|etfs?|bdrs?|cdbs?|lcis?|lcas?|tesoro|bonos?|cripto\w*|bitcoin)\b/i,
];
/** Texto que tenta mandar no modelo. Vale também para o que vira memória da família. */
export const INSTRUCTION =
  /https?:|www\.|<|\b(ignore|ignorar|ignora|instruções|instructions?|instrucciones|system prompt)\b/i;
/** Com milhar, "1,234.5%", e por extenso nos três idiomas. */
const PERCENT =
  /(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s?(?:%|por cento\b|percent\b|por ciento\b)/gi;

function uncheckedPercents(text: string, known: number[]): boolean {
  return [...text.matchAll(PERCENT)].some((match) => {
    const value = parseNumber(match[1]!);
    return value === null || !known.some((item) => Math.abs(item - value) <= 0.5);
  });
}

export function rejectionOf(
  text: string,
  known: number[],
  privacy: PrivacyFilter,
): InsightRejection | null {
  if (uncheckedAmounts(text, known).length > 0 || uncheckedPercents(text, known)) return "numero";
  if (TICKER.test(text)) return "ativo";
  if (ASSET_ORDERS.some((order) => order.test(text))) return "recomendacao";
  if (privacy.scrub(text) !== text) return "nome";
  if (INSTRUCTION.test(text)) return "instrucao";
  return null;
}
