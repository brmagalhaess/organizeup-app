/** Os agentes diários, na ordem em que rodam, explicados sem jargão. */
export const DAILY_AGENTS_INFO = [
  {
    id: "categorias",
    name: "Categorias",
    text: "Pelas regras, arruma sozinho o que está em categoria genérica e junta categorias quase iguais. A família vê em Notificações e pode desfazer.",
  },
  {
    id: "categorias_ia",
    name: "Categorias com IA",
    text: "Lê o que ficou em categoria genérica e move sozinho para a certa, ou cria uma nova. Pouca confiança não muda. Só roda com o aceite da família para usar IA.",
  },
  {
    id: "investimentos",
    name: "Investimentos",
    text: "Avisa de preço antigo e de carteira fora da divisão que a família escolheu.",
  },
  {
    id: "dividas",
    name: "Dívidas",
    text: "Compara as estratégias de quitação, diz qual dívida atacar e aponta juro alto e dado faltando.",
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
  {
    id: "relatorios",
    name: "Relatórios",
    text: "Roda por último. Atualiza o mês em andamento, fecha o mês no dia 1 e o ano em janeiro. Com o aceite da família, escreve um parágrafo com IA e confere os números.",
  },
] as const;

export const PAPERCLIP_URL = "https://paperclip.home.crowntech.com.br/ORG";
