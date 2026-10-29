/** Filas do pg-boss. Criadas pelo migrador (o worker roda sem permissão de DDL). */
export const JOB_QUEUES = {
  opsHeartbeat: "ops-heartbeat",
} as const;

export type JobQueue = (typeof JOB_QUEUES)[keyof typeof JOB_QUEUES];

export const PGBOSS_SCHEMA = "pgboss";
