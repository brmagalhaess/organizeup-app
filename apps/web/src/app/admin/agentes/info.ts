/** Os agentes diários, na ordem em que rodam, explicados sem jargão. */
export const DAILY_AGENTS_INFO = [
  {
    id: "categorias",
    name: "Categorias",
    text: "Pelas regras, arruma o que ficou para revisar na importação e sugere categorias melhores.",
  },
  {
    id: "categorias_ia",
    name: "Categorias com IA",
    text: "Lê o que ficou em Outras e move para a categoria certa, ou cria uma nova. O que a família escolheu vira sugestão. Só com o aceite da família.",
  },
  {
    id: "investimentos",
    name: "Investimentos",
    text: "Avisa de preço antigo e de carteira fora da divisão que a família escolheu.",
  },
  {
    id: "aposentadoria",
    name: "Aposentadoria",
    text: "Refaz a projeção e divide o que sobra no mês entre reserva, dívidas e investimentos.",
  },
  {
    id: "viagens",
    name: "Viagens",
    text: "Estima o custo das viagens desejadas e sugere quando cabem no orçamento.",
  },
  {
    id: "metas",
    name: "Metas",
    text: "Recalcula o plano mensal de cada meta, respeitando a prioridade e o orçamento.",
  },
] as const;

export const PAPERCLIP_URL = "https://paperclip.home.crowntech.com.br/ORG";
