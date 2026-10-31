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

export const PGBOSS_SCHEMA = "pgboss";
