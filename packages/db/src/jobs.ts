/** Filas do pg-boss. Criadas pelo migrador (o worker roda sem permissão de DDL). */
export const JOB_QUEUES = {
  opsHeartbeat: "ops-heartbeat",
  netWorthSnapshot: "net-worth-snapshot",
  /** Agentes diários do produto (categorias, investimentos, aposentadoria, viagens, metas). */
  dailyAgents: "daily-agents",
  /** Cotações, proventos e índices públicos, gravados nas tabelas globais de mercado (ADR-0017). */
  marketData: "market-data",
  /** Dicas por tela, com IA, depois dos agentes de regras. */
  aiInsights: "ai-insights",
  /** Contagens diárias da plataforma (ops.platform_stats). */
  platformStats: "platform-stats",
  /** Eventos da Stripe recebidos pela web, aplicados à assinatura da família (ADR-0023). */
  billingEvents: "billing-events",
  /** Aviso de renovação anual, 30 dias antes. */
  billingRenewals: "billing-renewals",
  /** Importador inteligente: lê um lote por pedido da família e limpa os vencidos (ADR-0030). */
  smartImport: "smart-import",
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

/** Sem `importId`: a limpeza diária dos lotes vencidos. */
export interface SmartImportJob {
  householdId?: string;
  importId?: string;
  /** O que o lote já leu: cada job lê um arquivo, e a rodada do painel conta o lote inteiro. */
  tally?: { files: number; byRules: number; byModel: number; failed: number };
}

export const smartImportKey = (importId: string) => `smart-import:${importId}`;

export const PGBOSS_SCHEMA = "pgboss";
