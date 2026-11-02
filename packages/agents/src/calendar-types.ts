// Tipo de cada item do calendário, como a família o reconhece. Puro, sem acesso ao banco.
import type { CalendarItem } from "@organizeup/domain";

export type CalendarItemType =
  "conta" | "receita" | "cartao" | "divida" | "meta" | "aporte" | "viagem" | "evento";

export interface CalendarTypeContext {
  /** Categoria de cada lançamento, pela chave: o item do calendário não a carrega. */
  categoryOf: Map<string, string>;
  /** Categorias do sistema. Depois de pago, o lançamento só diz a origem por aqui. */
  system: {
    card?: string | undefined;
    debt?: string | undefined;
    goal?: string | undefined;
    goalIncome?: string | undefined;
    contribution?: string | undefined;
  };
  /** Eventos criados por uma viagem. */
  tripEvents: Set<string>;
}

/** Previsto diz a origem em `source`; o que já foi pago virou lançamento comum e diz pela categoria. */
export function calendarItemType(
  item: CalendarItem,
  context: CalendarTypeContext,
): CalendarItemType {
  if (item.type === "fechamento") return "cartao";
  if (item.type === "compromisso") return context.tripEvents.has(item.id) ? "viagem" : "evento";
  if (item.source === "fatura") return "cartao";
  if (item.source === "parcela") return "divida";
  if (item.source === "meta") return "meta";
  const category = context.categoryOf.get(item.key);
  const { card, debt, goal, goalIncome, contribution } = context.system;
  if (category !== undefined) {
    if (category === goal || category === goalIncome) return "meta";
    if (category === contribution) return "aporte";
    if (category === card) return "cartao";
    if (category === debt) return "divida";
  }
  return item.kind === "receita" ? "receita" : "conta";
}
