// API pública do pacote de banco. Não existe export de `db` cru (ver AGENTS.md).
export * from "./schema";
export {
  HOUSEHOLD_ROLES,
  canWrite,
  fromJob,
  fromSession,
  getMembership,
  listMemberships,
  withHousehold,
  withWorkerHousehold,
  type HouseholdRole,
  type SessionLike,
  type TenantContext,
  type TenantRole,
  type TenantTx,
} from "./tenant";
export {
  adminHouseholdList,
  adminHouseholdOwnerEmail,
  adminOverviewCounts,
  withAdmin,
  withAdminRead,
  type AdminHouseholdRow,
  type AdminOverviewCounts,
} from "./admin";
export { exportHousehold } from "./export";
export { SYSTEM_TEMPLATES, ensureCategory, ensureFinanceDefaults } from "./finance";
export {
  householdTimezone,
  listActiveHouseholdIds,
  listHouseholdIds,
  netWorthInputs,
  recordNetWorth,
} from "./wealth";
export {
  addAgentMemory,
  databaseStatus,
  findAgentMemories,
  hasAgentRunToday,
  listAgentRuns,
  listCategorizationStats,
  listDeployments,
  listReports,
  listWorkerHeartbeats,
  recordAdminAccess,
  recordAgentRun,
  recordCategorizationStats,
  recordDeployment,
  recordWorkerHeartbeat,
  saveReport,
  type AgentRunCounts,
  type CategorizationCounts,
  type MemoryKind,
  type ReportKind,
} from "./ops";
export { JOB_QUEUES, PGBOSS_SCHEMA, type JobQueue } from "./jobs";
export { closeAllPools } from "./client";
// Operadores de consulta reexportados para que apps usem a MESMA instância do drizzle-orm.
export { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
