/** Filas do pg-boss. Criadas pelo migrador (o worker roda sem permissão de DDL). */
export const JOB_QUEUES = {
  opsHeartbeat: "ops-heartbeat",
  netWorthSnapshot: "net-worth-snapshot",
  /** Agentes diários do produto (categorias, investimentos, aposentadoria, viagens, metas). */
  dailyAgents: "daily-agents",
  /** Cotações, proventos e índices públicos, gravados nas tabelas globais de mercado (ADR-0017). */
  marketData: "market-data",
  /** Contagens diárias da plataforma (ops.platform_stats). */
  platformStats: "platform-stats",
} as const;

export type JobQueue = (typeof JOB_QUEUES)[keyof typeof JOB_QUEUES];

/** A rodada diária dos agentes tem uma chave só por dia, venha do boot ou do painel. */
export const dailyAgentsKey = (day: string) => `daily:${day}`;

/** Pedido de um agente só, feito pelo Paperclip. */
export const agentWakeKey = (day: string, agent: string) => `daily:${day}:${agent}`;

/** Sem campos, roda todos. `missingOnly` é a rede de segurança: só quem não rodou hoje. */
export interface DailyAgentsJob {
  agents?: string[];
  missingOnly?: boolean;
}

export const PGBOSS_SCHEMA = "pgboss";
