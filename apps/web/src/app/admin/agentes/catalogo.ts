// Agentes do produto na central do painel. A lista sai de `info.ts`, mais Mercado e Dicas, que rodam em
// filas próprias. Agente novo em `info.ts` aparece sozinho; o que só existe em `ops.agent_runs` também.
import { TRIP_INTENTIONS_RUN } from "@organizeup/domain";
import { DAILY_AGENTS_INFO } from "./info";

export const MERCADO_AGENT = "mercado";
export const DICAS_AGENT = "dicas";
/** Atualização automática da conexão com bancos (ADR-0038). Roda na web, e não no worker. */
export const BANCOS_AGENT = "bancos";
export const IMPORTADOR_CARD = "importador";

export interface ProductAgent {
  id: string;
  name: string;
  text: string;
  /** Quem acorda e a que horas, em uma frase. */
  wake: string;
  /** Tem interruptor e botão. Falso só para quem apareceu nas rodadas sem estar na lista. */
  controls: boolean;
  /** Roda por pedido da família: tem interruptor, e o botão de rodar não faria nada. */
  onDemand?: boolean;
}

const PAPERCLIP_TIMES: Record<string, string> = {
  categorias: "04:00",
  // A etapa de IA anda junto: o Paperclip acorda só `categorias`.
  "categorias-ia": "04:00",
  investimentos: "04:10",
  dividas: "04:15",
  aposentadoria: "04:20",
  viagens: "04:30",
  metas: "04:40",
  relatorios: "05:40",
};

const dailyWake = (id: string) => {
  const time = PAPERCLIP_TIMES[id];
  // O último da rodada entra na rede de segurança; o Paperclip vem depois só para conferir.
  if (id === "relatorios") return `O worker roda às 05:30. O Paperclip confere às ${time}.`;
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
    wake: "O worker coleta cotações de hora em hora e faz a rodada completa, com proventos, às 17:00 todo dia. O Paperclip confere às 03:45.",
    controls: true,
  },
  {
    id: DICAS_AGENT,
    name: "Dicas",
    text: "Com IA, escreve as dicas de cada tela para as famílias que autorizaram e confere os números antes de mostrar.",
    wake: "O worker roda às 05:45, depois dos outros agentes.",
    controls: true,
  },
  {
    id: BANCOS_AGENT,
    name: "Bancos",
    text: "Traz sozinho o que caiu nas contas e nos cartões ligados pela Pluggy: pula o que já entrou, dá baixa no que estava previsto e grava o resto, com Desfazer. Desligado, a família só traz pela conferência.",
    wake: "Roda quando a pessoa abre o sistema, no máximo a cada 6 horas, e quando o Paperclip acorda o agente. Não entra na rodada do worker.",
    controls: true,
    onDemand: true,
  },
  {
    id: IMPORTADOR_CARD,
    name: "Importador",
    text: "Lê os arquivos que a família envia, identifica cada um, propõe onde cada item entra e aponta duplicidade. Nada grava sem aprovação. Desligado, só as regras leem: a IA não é chamada.",
    wake: "Roda quando uma família envia arquivos, um por vez. Não entra na rodada da madrugada.",
    controls: true,
    onDemand: true,
  },
];

/** Agentes que o worker cobre às 05:30: se faltarem depois disso, algo está errado. */
export const DAILY_AGENT_IDS: string[] = DAILY_AGENTS_INFO.map((agent) => agent.id);

/** Linhas de `ops.agent_runs` que são contagem, não agente: não têm cartão nem entram no histórico. */
const COUNT_ONLY_RUNS = new Set<string>([TRIP_INTENTIONS_RUN]);

export const onlyAgents = <Run extends { agent: string }>(runs: Run[]) =>
  runs.filter((run) => !COUNT_ONLY_RUNS.has(run.agent));

/** A lista conhecida, mais quem só aparece nas rodadas: sem controles, mas com o histórico. */
export function agentsInView(seen: string[]): ProductAgent[] {
  const known = new Set(PRODUCT_AGENTS.map((agent) => agent.id));
  const others = [...new Set(seen)]
    .filter((id) => !known.has(id) && !COUNT_ONLY_RUNS.has(id))
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
  if (agent === IMPORTADOR_CARD) {
    return [
      ...shared,
      { label: "Lidos com IA", value: run.suggestions },
      { label: "Lidos por regras", value: run.applied },
    ];
  }
  return [
    ...shared,
    { label: "Sugestões", value: run.suggestions },
    { label: "Aplicadas", value: run.applied },
  ];
}
