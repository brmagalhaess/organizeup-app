// API pública do pacote de banco. Não existe export de `db` cru (ver AGENTS.md).
export * from "./schema";
export {
  HOUSEHOLD_ROLES,
  canWrite,
  fromJob,
  fromSession,
  getMembership,
  listMemberships,
  readOnlyContext,
  withHousehold,
  withWorkerHousehold,
  type HouseholdRole,
  type SessionLike,
  type TenantContext,
  type TenantRole,
  type TenantTx,
} from "./tenant";
export {
  FLAG_KEYS,
  NO_FLAGS,
  activeNotices,
  householdIsSuspended,
  isSchemaLag,
  parsePlatformFlags,
  readPlatformFlags,
  suspendedHouseholdIds,
  tolerateSchemaLag,
  userIsBlocked,
  type PlatformFlags,
  type PlatformNotice,
} from "./access";
export * from "./admin";
export {
  PLATFORM_MODULES,
  collectPlatformStats,
  householdModuleUsage,
  type ModuleUsage,
  type PlatformModule,
} from "./platform";
export { exportHousehold } from "./export";
export { SYSTEM_TEMPLATES, ensureCategory, ensureFinanceDefaults } from "./finance";
export {
  householdTimezone,
  listActiveHouseholdIds,
  listHouseholdIds,
  loadStockEvents,
  netWorthInputs,
  recordNetWorth,
} from "./wealth";
export {
  addAgentMemory,
  aiMonthTotals,
  databaseStatus,
  findAgentMemories,
  hasAgentRunToday,
  listAgentRuns,
  listCategorizationStats,
  listDeployments,
  listPlatformStats,
  listQueueCounts,
  listReports,
  listWorkerHeartbeats,
  recordAdminAccess,
  recordAgentRun,
  recordAiStats,
  recordCategorizationStats,
  recordDeployment,
  recordPlatformStats,
  recordWorkerHeartbeat,
  saveReport,
  type AgentRunCounts,
  type AiUsageCounts,
  type CategorizationCounts,
  type MemoryKind,
  type PlatformCounts,
  type QueueCount,
  type ReportKind,
} from "./ops";
export {
  DIAGNOSTIC_LIMITS,
  captureError,
  captureEvent,
  describeClientError,
  describeError,
  listDiagnosticRates,
  listDiagnostics,
  normalizeRoute,
  recordDiagnostic,
  resolveDiagnostic,
  type DiagnosticEvent,
  type DiagnosticFilters,
  type DiagnosticOrigin,
  type DiagnosticRate,
  type DiagnosticService,
  type DiagnosticSource,
  type DiagnosticStatus,
} from "./diagnostics";
export {
  addMarketCalls,
  listMarketTickers,
  marketCallsOn,
  saveMarketDividends,
  saveMarketIndices,
  findMarketAsset,
  saveMarketAssets,
  saveMarketQuote,
  searchMarketAssets,
  type MarketAssetRow,
  saveMarketStockEvents,
  saveMarketTicker,
  type MarketDividendRow,
  type MarketQuoteRow,
  type MarketStockEventRow,
} from "./market";
export { searchKnowledge } from "./knowledge";
export { KNOWLEDGE_SEED, type KnowledgeSeed } from "./knowledge-seed";
export {
  agentWakeKey,
  dailyAgentsKey,
  JOB_QUEUES,
  PGBOSS_SCHEMA,
  type DailyAgentsJob,
  type JobQueue,
} from "./jobs";
export { closeAllPools } from "./client";
// Operadores de consulta reexportados para que apps usem a MESMA instância do drizzle-orm.
export { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
