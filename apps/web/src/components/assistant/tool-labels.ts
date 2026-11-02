// O que o assistente olhou: `packages/ai` manda a frase em português, e as conversas guardam essa
// frase. A tela troca pela chave do catálogo; frase desconhecida aparece como veio.
const FIXED = {
  "organizei uma categoria": "organizedCategory",
  "deixei uma sugestão de quanto guardar": "savingSuggestion",
  "deixei uma sugestão para a sua meta": "goalSuggestion",
  "preparei uma meta em rascunho": "draftGoal",
  "criei um lembrete": "reminder",
  "olhei suas categorias": "categories",
  "olhei sua renda": "income",
  "olhei seus documentos": "documents",
  "olhei sua reserva": "reserve",
  "olhei suas dívidas": "debts",
  "olhei seu plano para sair das dívidas": "debtPlan",
  "olhei sua carteira": "portfolio",
  "olhei seus proventos": "dividends",
  "olhei seu plano de aposentadoria": "retirementPlan",
  "olhei suas metas": "goals",
  "olhei suas viagens": "trips",
  "olhei os relatórios de hoje": "reports",
  "olhei as sugestões pendentes": "suggestions",
  "olhei o seu plano do mês": "monthPlan",
  "olhei as regras oficiais": "rules",
  "deixei anotado para lembrar depois": "note",
  "simulei guardar mais por mês": "simulatedSaving",
  "simulei antecipar a aposentadoria": "simulatedRetirement",
  "simulei o prazo da sua meta": "simulatedGoal",
} as const;

const WITH_MONTH = {
  "olhei o resumo": "summary",
  "olhei seus lançamentos": "entries",
  "olhei seu calendário": "calendar",
} as const;

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

type MonthlyTool = (typeof WITH_MONTH)[keyof typeof WITH_MONTH];
export type ToolLabel =
  | { key: (typeof FIXED)[keyof typeof FIXED] | `${MonthlyTool}Current` }
  | { key: `${MonthlyTool}Month`; month: string };

const has = <T extends object>(table: T, key: string): key is Extract<keyof T, string> =>
  Object.hasOwn(table, key);

/** Chave da frase, com o mês em "AAAA-MM" quando ela cita um. Null: frase que a tela não conhece. */
export function toolLabel(text: string): ToolLabel | null {
  if (has(FIXED, text)) return { key: FIXED[text] };
  const current = text.endsWith(" do mês") ? text.slice(0, -" do mês".length) : "";
  if (has(WITH_MONTH, current)) return { key: `${WITH_MONTH[current]}Current` };
  const dated = /^(.+) de ([^\s]+) de (\d{4})$/.exec(text);
  const month = dated ? MONTHS.indexOf(dated[2]!) + 1 : 0;
  if (!dated || month === 0 || !has(WITH_MONTH, dated[1]!)) return null;
  return {
    key: `${WITH_MONTH[dated[1]!]}Month`,
    month: `${dated[3]}-${String(month).padStart(2, "0")}`,
  };
}
