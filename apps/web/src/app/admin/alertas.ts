// O que merece atenção no topo da visão geral. Funções puras: recebem o que as telas já leram.
import { DICAS_AGENT, MERCADO_AGENT } from "./agentes/catalogo";

export interface AdminAlert {
  key: string;
  tone: "danger" | "warning" | "info";
  title: string;
  text: string;
  href: string;
}

/** O heartbeat roda a cada 5 minutos: acima disso por três ciclos, o worker parou. */
export const WORKER_STALE_MINUTES = 15;
/** Tempo para os dois serviços terminarem de subir depois de um deploy. */
const DEPLOY_GRACE_MINUTES = 15;
/** Erro aberto que apareceu há menos que isto é novidade; depois, fica só na tela Sistema. */
const NEW_ERROR_MINUTES = 24 * 60;
/** O Paperclip começa às 04:00 de Brasília, e o worker cobre às 05:30; às 06:00 já devia ter terminado. */
const DAILY_RUN_HOUR = 6;
/** As dicas começam às 05:45 e só registram a rodada no fim, depois de falar com o modelo. */
const INSIGHTS_RUN_HOUR = 7;
/** Sem sair do ar, o catálogo é atualizado todo dia útil: mais que isto já é problema. */
const CATALOG_STALE_DAYS = 2;
const DAY_MS = 86_400_000;

interface Input {
  now: Date;
  /** `YYYY-MM-DD` e hora em Brasília. */
  today: string;
  hour: number;
  runs: Array<{ day: string; agent: string; failed: number }>;
  workers: Array<{ lastSeenAt: Date }>;
  deployments: Array<{ service: "web" | "worker"; commit: string; startedAt: Date }>;
  queues: Array<{ name: string; failed: number }>;
  /** Erros abertos. */
  diagnostics: Array<{ firstSeenAt: Date }>;
  statsDay: string | null;
  maintenance: boolean;
  signupClosed: boolean;
  documentKeyMissing?: boolean;
  documentKeyChanged?: boolean;
  documentRefusalsHigh?: boolean;
  allAgentsOff: boolean;
  /** Gasto de IA do mês contra o teto. */
  aiSpend?: { spentUsd: number; budgetUsd: number; reached: boolean };
  /** Agentes ligados que o worker cobre às 05:30. Mercado e Dicas têm alerta próprio. */
  expectedAgents?: Array<{ id: string; name: string }>;
  /** Dicas ligadas, com chave no worker e fora da manutenção: hoje deviam rodar. */
  insightsExpected?: boolean;
  /** Último `Testar a IA`. */
  aiTest?: { ok: boolean; at: Date } | null;
  /** Null: catálogo vazio. Sem o campo, o Mercado está desligado e não há o que cobrar. */
  catalogUpdatedAt?: Date | null;
  /** `YYYY-MM-DD` da revisão mais antiga da base de conhecimento. */
  knowledgeOldest?: string | null;
  /** Falso quando o worker avisou que não tem a chave. Sem sinal dele, fica de fora. */
  workerHasAiKey?: boolean | null;
  /** O que pede atenção na cobrança (ADR-0025). */
  billing?: {
    vipEnding: number;
    /** Cortesia ou VIP sem custo, e a Stripe segue cobrando. */
    vipCharged: number;
    /** Desconto concedido que a Stripe ainda não aplica. */
    unappliedDiscounts: number;
    /** Desconto na Stripe sem VIP valendo. */
    leftoverDiscounts: number;
    /** Segunda assinatura paga: a Stripe cobra duas vezes. */
    duplicates: number;
  };
}

export const catalogStale = (updatedAt: Date, now: Date) =>
  now.getTime() - updatedAt.getTime() > CATALOG_STALE_DAYS * DAY_MS;

/** Revisão anual: mais de 12 meses. `YYYY-MM-DD` ordena certo como texto e não muda com o fuso. */
export function knowledgeExpired(oldest: string, today: string) {
  return oldest < `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
}

/** A partir daqui o painel já avisa, antes de o assistente parar sozinho. */
const AI_WARNING_SHARE = 0.8;

function aiAlert({ aiSpend }: Input): AdminAlert | null {
  if (!aiSpend) return null;
  const { spentUsd, budgetUsd, reached } = aiSpend;
  const dollars = (value: number) => `US$ ${value.toFixed(2)}`;
  if (reached) {
    return {
      key: "ia:teto",
      tone: "danger",
      title: "Assistente parado: teto do mês atingido",
      text: `Gastou ${dollars(spentUsd)} de ${dollars(budgetUsd)}. Volta sozinho no próximo mês, ou suba AI_MONTHLY_BUDGET_USD.`,
      href: "/admin/sistema",
    };
  }
  if (spentUsd < budgetUsd * AI_WARNING_SHARE) return null;
  return {
    key: "ia:perto",
    tone: "warning",
    title: "Assistente perto do teto do mês",
    text: `Gastou ${dollars(spentUsd)} de ${dollars(budgetUsd)}.`,
    href: "/admin/sistema",
  };
}

const minutesAgo = (from: Date, now: Date) => Math.floor((now.getTime() - from.getTime()) / 60_000);

const formatDay = (day: string) => day.split("-").reverse().join("/");

function failureText(run: Input["runs"][number]) {
  const day = formatDay(run.day);
  if (run.agent === MERCADO_AGENT) {
    return run.failed === 1
      ? `1 consulta falhou em ${day}.`
      : `${run.failed} consultas falharam em ${day}.`;
  }
  return run.failed === 1
    ? `Falhou em 1 família em ${day}.`
    : `Falhou em ${run.failed} famílias em ${day}.`;
}

function agentAlerts({
  runs,
  today,
  hour,
  maintenance,
  allAgentsOff,
  expectedAgents = [],
}: Input): AdminAlert[] {
  const lastDay = runs[0]?.day ?? null;
  const failed = runs.filter((run) => run.day === lastDay && run.failed > 0);
  const alerts: AdminAlert[] = failed.map((run) => ({
    key: `agente:${run.agent}`,
    tone: "danger",
    title: `Agente ${run.agent} com falha`,
    text: failureText(run),
    href: "/admin/agentes",
  }));
  if (hour < DAILY_RUN_HOUR || maintenance || allAgentsOff) return alerts;
  if (lastDay !== today) {
    alerts.push({
      key: "agentes:sem_rodada",
      tone: "warning",
      title: "A rodada de hoje não aconteceu",
      text: lastDay
        ? `A última foi em ${formatDay(lastDay)}. Confira o worker ou use Rodar agora.`
        : "Nenhuma rodada registrada ainda. Confira o worker ou use Rodar agora.",
      href: "/admin/agentes",
    });
    return alerts;
  }
  const ran = new Set(runs.filter((run) => run.day === today).map((run) => run.agent));
  const missing = expectedAgents.filter((agent) => !ran.has(agent.id));
  if (missing.length > 0) {
    const names = missing.map((agent) => agent.name).join(", ");
    alerts.push({
      key: "agentes:faltando",
      tone: "warning",
      title: missing.length === 1 ? `${names} sem rodar hoje` : "Agentes sem rodar hoje",
      text:
        missing.length === 1
          ? "O worker devia ter rodado às 05:30. Use Rodar agora."
          : `Faltaram: ${names}. O worker devia ter rodado às 05:30.`,
      href: "/admin/agentes",
    });
  }
  return alerts;
}

function insightsAlert({ runs, today, hour, insightsExpected }: Input): AdminAlert | null {
  if (!insightsExpected || hour < INSIGHTS_RUN_HOUR) return null;
  if (runs.some((run) => run.day === today && run.agent === DICAS_AGENT)) return null;
  return {
    key: "dicas:sem_rodada",
    tone: "warning",
    title: "As dicas de hoje não rodaram",
    text: "Deviam ter rodado às 05:45. Confira o worker ou use Rodar agora no cartão das Dicas.",
    href: "/admin/agentes",
  };
}

function aiTestAlert({ aiTest }: Input): AdminAlert | null {
  if (!aiTest || aiTest.ok) return null;
  return {
    key: "ia:teste",
    tone: "warning",
    title: "O último Testar a IA falhou",
    text: "Veja o motivo na tela Sistema e teste de novo. O aviso sai quando o teste passar.",
    href: "/admin/sistema",
  };
}

function workerKeyAlert({ workerHasAiKey }: Input): AdminAlert | null {
  if (workerHasAiKey !== false) return null;
  return {
    key: "ia:worker",
    tone: "warning",
    title: "Worker sem a chave da IA",
    text: "As dicas da madrugada não rodam até colocar ANTHROPIC_API_KEY em ou3-worker.",
    href: "/admin/sistema",
  };
}

function billingAlerts({ billing }: Input): AdminAlert[] {
  if (!billing) return [];
  const { vipEnding, vipCharged, unappliedDiscounts, leftoverDiscounts, duplicates } = billing;
  const alerts: AdminAlert[] = [];
  if (duplicates > 0) {
    alerts.push({
      key: "cobranca:duplicada",
      tone: "danger",
      title: "Família cobrada duas vezes",
      text:
        duplicates === 1
          ? "1 assinatura paga não entrou, e a Stripe segue cobrando."
          : `${duplicates} assinaturas pagas não entraram, e a Stripe segue cobrando.`,
      href: "/admin/cobranca",
    });
  }
  if (vipCharged > 0) {
    alerts.push({
      key: "vip:cobrado",
      tone: "danger",
      title: "Cortesia ou VIP sendo cobrado",
      text: "A Stripe segue cobrando quem não devia pagar. Cancele para a família não pagar pelo que ganhou.",
      href: "/admin/vip",
    });
  }
  if (vipEnding > 0) {
    alerts.push({
      key: "vip:vencendo",
      tone: "warning",
      title: vipEnding === 1 ? "VIP perto de vencer" : "VIPs perto de vencer",
      text:
        vipEnding === 1
          ? "1 concessão vence em breve. Ao vencer, volta ao que era, sem cobrança."
          : `${vipEnding} concessões vencem em breve. Ao vencer, voltam ao que eram, sem cobrança.`,
      href: "/admin/vip?situacao=vencendo",
    });
  }
  if (unappliedDiscounts > 0) {
    alerts.push({
      key: "vip:nao_aplicado",
      tone: "warning",
      title: "Desconto concedido e não aplicado",
      text: "A Stripe ainda cobra outro valor. Aplique o desconto na assinatura da família.",
      href: "/admin/vip",
    });
  }
  if (leftoverDiscounts > 0) {
    alerts.push({
      key: "vip:desconto",
      tone: "info",
      title: "Desconto na Stripe sem VIP valendo",
      text: "O preço não sobe sozinho. Tirar o desconto é uma ação sua, avisando a família.",
      href: "/admin/vip",
    });
  }
  return alerts;
}

function catalogAlert({ catalogUpdatedAt, now }: Input): AdminAlert | null {
  if (catalogUpdatedAt === undefined) return null;
  if (catalogUpdatedAt === null) {
    return {
      key: "mercado:catalogo",
      tone: "warning",
      title: "Catálogo de ativos vazio",
      text: "O agente Mercado ainda não gravou a lista da bolsa.",
      href: "/admin/sistema",
    };
  }
  if (!catalogStale(catalogUpdatedAt, now)) return null;
  const days = Math.floor((now.getTime() - catalogUpdatedAt.getTime()) / DAY_MS);
  return {
    key: "mercado:catalogo",
    tone: "warning",
    title: "Catálogo de ativos velho",
    text: `A última atualização foi há ${days} dias. Confira o agente Mercado.`,
    href: "/admin/sistema",
  };
}

function knowledgeAlert({ knowledgeOldest, today }: Input): AdminAlert | null {
  if (!knowledgeOldest || !knowledgeExpired(knowledgeOldest, today)) return null;
  return {
    key: "base:vencida",
    tone: "warning",
    title: "Base do assistente com revisão vencida",
    text: `O trecho mais antigo foi revisado em ${formatDay(knowledgeOldest)}, há mais de 12 meses.`,
    href: "/admin/sistema",
  };
}

function workerAlert({ workers, now }: Input): AdminAlert | null {
  if (workers.length === 0) {
    return {
      key: "worker",
      tone: "danger",
      title: "Worker sem sinal",
      text: "Nenhum worker enviou sinal ainda.",
      href: "/admin/sistema",
    };
  }
  const freshest = Math.min(...workers.map((worker) => minutesAgo(worker.lastSeenAt, now)));
  if (freshest <= WORKER_STALE_MINUTES) return null;
  return {
    key: "worker",
    tone: "danger",
    title: "Worker sem sinal",
    text: `O último sinal foi há ${freshest} minutos. Filas e agentes estão parados.`,
    href: "/admin/sistema",
  };
}

function errorAlert({ diagnostics, now }: Input): AdminAlert | null {
  const fresh = diagnostics.filter(
    (error) => minutesAgo(error.firstSeenAt, now) < NEW_ERROR_MINUTES,
  ).length;
  if (fresh === 0) return null;
  return {
    key: "erros",
    tone: "danger",
    title: fresh === 1 ? "Erro novo no serviço" : "Erros novos no serviço",
    text:
      fresh === 1
        ? "1 erro apareceu nas últimas 24 horas e segue aberto."
        : `${fresh} erros apareceram nas últimas 24 horas e seguem abertos.`,
    href: "/admin/sistema",
  };
}

function deployAlert({ deployments, now }: Input): AdminAlert | null {
  const web = deployments.find((deploy) => deploy.service === "web");
  const worker = deployments.find((deploy) => deploy.service === "worker");
  if (!web || !worker || web.commit === worker.commit) return null;
  const newest = web.startedAt > worker.startedAt ? web : worker;
  if (minutesAgo(newest.startedAt, now) < DEPLOY_GRACE_MINUTES) return null;
  const late = newest === web ? "O worker" : "A web";
  return {
    key: "deploy",
    tone: "warning",
    title: "Deploy atrasado",
    text: `${late} ainda não subiu a versão ${newest.commit.slice(0, 7)}.`,
    href: "/admin/sistema",
  };
}

/** Ordem: o que está quebrado, depois o que pede olhar, depois o que foi escolhido de propósito. */
export function buildAlerts(input: Input): AdminAlert[] {
  const alerts = [...agentAlerts(input)];
  const worker = workerAlert(input);
  if (worker) alerts.push(worker);
  const error = errorAlert(input);
  if (error) alerts.push(error);
  const deploy = deployAlert(input);
  if (deploy) alerts.push(deploy);
  alerts.push(...billingAlerts(input));
  for (const alert of [
    aiAlert(input),
    workerKeyAlert(input),
    aiTestAlert(input),
    insightsAlert(input),
    catalogAlert(input),
    knowledgeAlert(input),
  ]) {
    if (alert) alerts.push(alert);
  }
  const failedJobs = input.queues.reduce((total, queue) => total + queue.failed, 0);
  if (failedJobs > 0) {
    alerts.push({
      key: "filas",
      tone: "warning",
      title: "Tarefas com falha nas filas",
      text: failedJobs === 1 ? "1 tarefa falhou." : `${failedJobs} tarefas falharam.`,
      href: "/admin/sistema",
    });
  }
  if (input.statsDay !== input.today && input.hour >= DAILY_RUN_HOUR) {
    alerts.push({
      key: "contagens",
      tone: "info",
      title: "Contagens desatualizadas",
      text: input.statsDay
        ? `A adoção por módulo é de ${formatDay(input.statsDay)}.`
        : "A adoção por módulo aparece depois da primeira contagem do worker.",
      href: "/admin/agentes",
    });
  }
  if (input.maintenance) {
    alerts.push({
      key: "manutencao",
      tone: "warning",
      title: "Modo manutenção ligado",
      text: "As famílias estão só leitura e os agentes estão parados.",
      href: "/admin/controles",
    });
  }
  if (input.documentKeyMissing) {
    alerts.push({
      key: "cofre",
      tone: "danger",
      title: "Falta a chave dos documentos",
      text: "Sem DOCUMENT_ENCRYPTION_KEY na web, cadastro com CPF é recusado. Nada fica em texto puro.",
      href: "/admin/sistema",
    });
  }
  if (input.documentKeyChanged) {
    alerts.push({
      key: "cofre-trocado",
      tone: "danger",
      title: "A chave dos documentos mudou",
      text: "Há documento cifrado com outra chave. Os documentos não abrem, a duplicidade não funciona e cadastro com CPF está recusado. Volte a chave ou recifre.",
      href: "/admin/sistema",
    });
  }
  if (input.documentRefusalsHigh) {
    alerts.push({
      key: "recusas",
      tone: "warning",
      title: "Muitas recusas de documento nesta hora",
      text: "Pode ser alguém testando CPFs. Quem já foi recusado parou de consultar até a hora virar. Quem acerta segue se cadastrando.",
      href: "/admin/sistema",
    });
  }
  if (input.signupClosed) {
    alerts.push({
      key: "cadastro",
      tone: "info",
      title: "Cadastro fechado",
      text: "Só entra quem recebeu convite de uma família.",
      href: "/admin/controles",
    });
  }
  const order = { danger: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.tone] - order[b.tone]);
}
