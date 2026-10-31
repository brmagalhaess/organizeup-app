// O que merece atenção no topo da visão geral. Funções puras: recebem o que as telas já leram.

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
/** A rodada começa às 04:00 de Brasília; às 06:00 ela já devia ter terminado. */
const DAILY_RUN_HOUR = 6;

interface Input {
  now: Date;
  /** `YYYY-MM-DD` e hora em Brasília. */
  today: string;
  hour: number;
  runs: Array<{ day: string; agent: string; failed: number }>;
  workers: Array<{ lastSeenAt: Date }>;
  deployments: Array<{ service: "web" | "worker"; commit: string; startedAt: Date }>;
  queues: Array<{ name: string; failed: number }>;
  statsDay: string | null;
  maintenance: boolean;
  signupClosed: boolean;
  allAgentsOff: boolean;
}

const minutesAgo = (from: Date, now: Date) => Math.floor((now.getTime() - from.getTime()) / 60_000);

const formatDay = (day: string) => day.split("-").reverse().join("/");

function agentAlerts({ runs, today, hour, maintenance, allAgentsOff }: Input): AdminAlert[] {
  const lastDay = runs[0]?.day ?? null;
  const failed = runs.filter((run) => run.day === lastDay && run.failed > 0);
  const alerts: AdminAlert[] = failed.map((run) => ({
    key: `agente:${run.agent}`,
    tone: "danger",
    title: `Agente ${run.agent} com falha`,
    text:
      run.failed === 1
        ? `Falhou em 1 família em ${formatDay(run.day)}.`
        : `Falhou em ${run.failed} famílias em ${formatDay(run.day)}.`,
    href: "/admin/agentes",
  }));
  if (lastDay !== today && hour >= DAILY_RUN_HOUR && !maintenance && !allAgentsOff) {
    alerts.push({
      key: "agentes:sem_rodada",
      tone: "warning",
      title: "A rodada de hoje não aconteceu",
      text: lastDay
        ? `A última foi em ${formatDay(lastDay)}. Confira o worker ou use Rodar agora.`
        : "Nenhuma rodada registrada ainda. Confira o worker ou use Rodar agora.",
      href: "/admin/agentes",
    });
  }
  return alerts;
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
  const deploy = deployAlert(input);
  if (deploy) alerts.push(deploy);
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
