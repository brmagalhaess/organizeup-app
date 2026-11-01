// Agentes do produto na central do painel. A lista sai de `info.ts`, mais Mercado e Dicas, que rodam em
// filas próprias. Agente novo em `info.ts` aparece sozinho; o que só existe em `ops.agent_runs` também.
import { DAILY_AGENTS_INFO } from "./info";

export const MERCADO_AGENT = "mercado";
export const DICAS_AGENT = "dicas";

export interface ProductAgent {
  id: string;
  name: string;
  text: string;
  /** Quem acorda e a que horas, em uma frase. */
  wake: string;
  /** Tem interruptor e botão. Falso só para quem apareceu nas rodadas sem estar na lista. */
  controls: boolean;
}

const PAPERCLIP_TIMES: Record<string, string> = {
  categorias: "04:00",
  // A etapa de IA anda junto: o Paperclip acorda só `categorias`.
  categorias_ia: "04:00",
  investimentos: "04:10",
  aposentadoria: "04:20",
  viagens: "04:30",
  metas: "04:40",
};

const dailyWake = (id: string) => {
  const time = PAPERCLIP_TIMES[id];
  return time
    ? `O Paperclip acorda às ${time}. Se faltar, o worker roda às 05:30.`
    : "O worker roda às 05:30.";
};

export const PRODUCT_AGENTS: ProductAgent[] = [
  ...DAILY_AGENTS_INFO.map((agent) => ({
    id: agent.id,
    name: agent.name,
    text: agent.text,
    wake: dailyWake(agent.id),
    controls: true,
  })),
  {
    id: MERCADO_AGENT,
    name: "Mercado",
    text: "Busca cotações, proventos, índices e a lista de ativos da bolsa antes dos outros agentes.",
    wake: "O Paperclip acorda às 03:45 se ainda não rodou. O worker roda às 18:30 nos dias úteis e às 03:30 de terça a sábado.",
    controls: true,
  },
  {
    id: DICAS_AGENT,
    name: "Dicas",
    text: "Com IA, escreve as dicas de cada tela para as famílias que autorizaram e confere os números antes de mostrar.",
    wake: "O worker roda às 05:45, depois dos outros agentes.",
    controls: true,
  },
];

/** Agentes que o worker cobre às 05:30: se faltarem depois disso, algo está errado. */
export const DAILY_AGENT_IDS: string[] = DAILY_AGENTS_INFO.map((agent) => agent.id);

/** A lista conhecida, mais quem só aparece nas rodadas: sem controles, mas com o histórico. */
export function agentsInView(seen: string[]): ProductAgent[] {
  const known = new Set(PRODUCT_AGENTS.map((agent) => agent.id));
  const others = [...new Set(seen)]
    .filter((id) => !known.has(id))
    .sort()
    .map((id) => ({
      id,
      name: agentName(id),
      text: "Apareceu nas rodadas e ainda não tem descrição aqui.",
      wake: "Horário ainda não cadastrado no painel.",
      controls: false,
    }));
  return [...PRODUCT_AGENTS, ...others];
}

export function agentName(id: string) {
  const known = PRODUCT_AGENTS.find((agent) => agent.id === id);
  return known?.name ?? `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

interface RunCounts {
  households: number;
  ok: number;
  failed: number;
  suggestions: number;
  applied: number;
}

/**
 * Números de uma rodada, com o nome certo para cada agente. No Mercado, `ok` são cotações e `applied`
 * o que foi gravado de proventos, eventos e índices. Nas Dicas, `suggestions` são dicas criadas.
 */
export function runMetrics(agent: string, run: RunCounts, discarded = 0) {
  const shared = [
    { label: "Famílias", value: run.households },
    { label: "Falhas", value: run.failed },
  ];
  if (agent === MERCADO_AGENT) {
    return [
      ...shared,
      { label: "Cotações", value: run.ok },
      { label: "Proventos e índices", value: run.applied },
    ];
  }
  if (agent === DICAS_AGENT) {
    return [
      ...shared,
      { label: "Criadas", value: run.suggestions },
      { label: "Descartadas", value: discarded },
    ];
  }
  return [
    ...shared,
    { label: "Sugestões", value: run.suggestions },
    { label: "Aplicadas", value: run.applied },
  ];
}
