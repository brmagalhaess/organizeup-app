// Equipe do Paperclip, em código: a web não tem acesso à API de lá. Papel e horários seguem
// `paperclip/agentes/*.md`. O estado ao vivo fica no Paperclip; aqui só entra o que a equipe registrou.
import { PAPERCLIP_URL } from "./info";

export interface TeamAgent {
  id: string;
  name: string;
  role: string;
  wake: string;
  /** Nomes com que o agente assina relatórios, memórias e rodadas. */
  slugs: string[];
  /** Id no Paperclip. Sem ele, o link vai para a tela geral de agentes. */
  paperclipId?: string;
}

export const PAPERCLIP_TEAM: TeamAgent[] = [
  {
    id: "tech-lead",
    name: "Tech Lead",
    role: "Organiza as tarefas e abre os reparos do dia.",
    wake: "Todo dia às 06:00. Resumo semanal na segunda às 08:00.",
    slugs: ["tech-lead"],
  },
  {
    id: "engenheiro",
    name: "Engenheiro",
    role: "Implementa as tarefas e abre as mudanças para revisão.",
    wake: "Quando recebe tarefa.",
    slugs: ["engenheiro"],
  },
  {
    id: "revisor-qa",
    name: "Revisor QA",
    role: "Revisa cada mudança e publica o que passou.",
    wake: "Quando recebe tarefa.",
    slugs: ["revisor-qa", "revisor"],
  },
  {
    id: "sre",
    name: "SRE",
    role: "Confere se o sistema está no ar e reverte o que piorou.",
    wake: "Todo dia às 07:30.",
    slugs: ["sre"],
  },
  {
    id: "gestor-de-agentes",
    name: "Gestor de Agentes",
    role: "Cuida da equipe: contrata, ajusta e pede para encerrar.",
    wake: "Quando recebe tarefa.",
    slugs: ["gestor-de-agentes", "gestor"],
  },
  {
    id: "mercado",
    name: "Mercado",
    role: "Acorda a coleta de cotações e confere o resultado.",
    wake: "Todo dia às 03:45.",
    slugs: ["mercado"],
  },
  {
    id: "categorias",
    name: "Categorias",
    role: "Acorda o agente de categorias e confere o resultado.",
    wake: "Todo dia às 04:00.",
    slugs: ["categorias", "categorias_ia"],
  },
  {
    id: "investimentos",
    name: "Investimentos",
    role: "Acorda o agente de investimentos e confere o resultado.",
    wake: "Todo dia às 04:10.",
    slugs: ["investimentos"],
  },
  {
    id: "dividas",
    name: "Dívidas",
    role: "Acorda o agente de dívidas e confere o resultado.",
    wake: "Todo dia às 04:15.",
    slugs: ["dividas"],
  },
  {
    id: "aposentadoria",
    name: "Aposentadoria",
    role: "Acorda o agente de aposentadoria e confere o resultado.",
    wake: "Todo dia às 04:20.",
    slugs: ["aposentadoria"],
  },
  {
    id: "viagens",
    name: "Viagens",
    role: "Acorda o agente de viagens e confere o resultado.",
    wake: "Todo dia às 04:30.",
    slugs: ["viagens"],
  },
  {
    id: "metas",
    name: "Metas",
    role: "Acorda o agente de metas e confere o resultado.",
    wake: "Todo dia às 04:40.",
    slugs: ["metas"],
  },
  {
    id: "relatorios",
    name: "Relatórios",
    role: "Confere os relatórios da família, que o worker gera às 05:30.",
    wake: "Todo dia às 05:40.",
    slugs: ["relatorios"],
  },
  {
    id: "produto",
    name: "Produto",
    role: "Lê as contagens de uso e propõe melhorias.",
    wake: "Segunda às 09:00.",
    slugs: ["produto"],
  },
  {
    id: "seguranca",
    name: "Segurança",
    role: "Procura risco no código e nas dependências.",
    wake: "Segunda às 09:30.",
    slugs: ["seguranca"],
  },
  {
    id: "documentacao",
    name: "Documentação",
    role: "Confere se a documentação acompanha o código.",
    wake: "Segunda às 10:00.",
    slugs: ["documentacao"],
  },
];

export type ActivitySource = "relatorio" | "memoria" | "rodada";

export interface ActivityRecord {
  agent: string;
  at: Date;
  source: ActivitySource;
}

export const SOURCE_LABELS: Record<ActivitySource, string> = {
  relatorio: "relatório",
  memoria: "memória",
  rodada: "rodada",
};

/** O registro mais recente do agente, ou null: nunca um status inventado. */
export function lastActivity(agent: TeamAgent, records: ActivityRecord[]): ActivityRecord | null {
  let latest: ActivityRecord | null = null;
  for (const record of records) {
    if (!agent.slugs.includes(record.agent)) continue;
    if (!latest || record.at > latest.at) latest = record;
  }
  return latest;
}

export const paperclipAgentUrl = (agent: TeamAgent) =>
  `${PAPERCLIP_URL}/agents${agent.paperclipId ? `/${agent.paperclipId}` : ""}`;
