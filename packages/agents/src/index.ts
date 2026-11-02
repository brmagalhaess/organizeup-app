// API pública dos agentes do produto (ADR-0015/0016). Tudo roda dentro de um TenantTx recebido.
export {
  APPLY_REPLIES,
  applySuggestion,
  dismissSuggestion,
  recordDividendRemoval,
  undoSuggestion,
  type ApplyCode,
  type ApplyResult,
} from "./apply";
export {
  BRAPI_SOURCE,
  fetchBrapiQuote,
  fetchFiiDividends,
  fetchFxSeries,
  fetchSgsSeries,
  KEYLESS_TICKERS,
  MarketError,
  SGS_SERIES,
  type BrapiQuote,
  type MarketErrorCode,
} from "./market";
export {
  DEFAULT_MAX_CALLS_PER_DAY,
  MERCADO_AGENT,
  runMarketData,
  type MarketRunOptions,
  type MarketRunResult,
} from "./run-mercado";
export {
  cardBook,
  goalEntryDescription,
  loadCommitments,
  scheduledIncome,
  systemCategories,
} from "./commitments";
export { loadBlocks } from "./market-sync";
export { calendarMonth } from "./calendar-view";
export type { CalendarItemType } from "./calendar-types";
export { currentDebtPlan, type DebtPlanView } from "./debt-view";
export {
  confirmDebtDocument,
  createDebtWithSchedule,
  deleteDebtDocument,
  listDebtDocuments,
  loadDebtDocumentFile,
  saveDebtDocument,
  updateDebtTerms,
  type ConfirmDebtDocument,
  type DebtDocumentRow,
  type NewDebt,
  type SaveDebtDocumentResult,
} from "./debt-documents";
export { monthlyPlanView } from "./plan-view";
export { currentDividendPlan } from "./retirement-view";
export {
  DEFAULT_RETIREMENT_AGE,
  dividendPlanInputs,
  loadFiscalTables,
  reserveInputs,
  loadSavingsRule,
  surplusInputs,
  type DividendPlanData,
  type ReserveData,
  type RetirementPlanRow,
  type SurplusData,
} from "./inputs";
export type {
  DailyReport,
  DailyReportKind,
  ReportAposentadoria,
  ReportCategorias,
  ReportData,
  ReportDividas,
  ReportInvestimentos,
  ReportMetas,
  ReportSurplus,
  ReportViagens,
} from "./reports";
export {
  APOSENTADORIA_AGENT,
  runAposentadoriaAgent,
  type AposentadoriaResult,
} from "./run-aposentadoria";
export {
  categoryNotificationSchema,
  MAX_NIGHT_NOTIFICATIONS,
  type CategoryNotification,
} from "./notifications";
export { applyGroup, CATEGORIAS_AGENT, runCategoriasAgent } from "./run-categorias";
export {
  applyCategoryPlan,
  CATEGORIAS_IA_AGENT,
  loadCategoryCandidates,
  MAX_AI_GROUPS,
  MAX_AI_NEW_CATEGORIES,
  type CategoryApplyResult,
  type CategoryReviewInput,
} from "./run-categorias-ia";
export {
  CLASS_DEVIATION_POINTS,
  INVESTIMENTOS_AGENT,
  runInvestimentosAgent,
} from "./run-investimentos";
export { DIVIDAS_AGENT, runDividasAgent } from "./run-dividas";
export { METAS_AGENT, runMetasAgent } from "./run-metas";
export { RELATORIOS_AGENT, runRelatoriosAgent, type RelatoriosResult } from "./run-relatorios";
export {
  householdCurrency,
  latestStatement,
  narrationPeriods,
  readStatement,
  statementKinds,
  statementPeriods,
} from "./statements";
export {
  loadDestinations,
  loadIntentionDecisions,
  loadTripIntentions,
  runViagensAgent,
  VIAGENS_AGENT,
  type IntentionDecisions,
  type TripIntentionRow,
  type ViagensResult,
} from "./run-viagens";
export {
  ASSET_CLASS_LABELS,
  IGNORED_DAYS,
  loadDecisions,
  recordAudit,
  ASSISTANT_AGENT,
  resolveAllocation,
  REVIEW_DAYS,
  STALE_PRICE_DAYS,
  type AgentInput,
  type AgentResult,
} from "./shared";
export {
  amountSchema,
  AUTOMATIC_SUGGESTION_KINDS,
  aporteDividaPayloadSchema,
  aporteInvestimentoPayloadSchema,
  aporteReservaPayloadSchema,
  categoriaPayloadSchema,
  DEDUPE,
  fusaoCategoriaPayloadSchema,
  investimentoPayloadSchema,
  linkPayloadSchema,
  marketChangesSchema,
  metaPayloadSchema,
  parsePayload,
  SUGGESTION_PAYLOADS,
  tripEstimateSchema,
  viagemPayloadSchema,
  yearMonthSchema,
  type AporteDividaPayload,
  type AporteInvestimentoPayload,
  type AporteReservaPayload,
  type CategoriaPayload,
  type FusaoCategoriaPayload,
  type InvestimentoPayload,
  type LinkPayload,
  type MarketChanges,
  type MetaPayload,
  type SuggestionPayload,
  type ViagemPayload,
} from "./suggestions";
export { currentAllocation } from "./run-aposentadoria";
export {
  AGENT_MODULE,
  agentMayRun,
  applyBillingEvent,
  billingEventData,
  MAX_EVENT_ATTEMPTS,
  runBillingEvents,
  runBillingRenewals,
  runVipNotices,
  SUGGESTION_MODULE,
  type BillingEventData,
  type BillingOutcome,
  type BillingRunResult,
} from "./billing";
export * from "./texts";
export { createTrip, type CreateTripInput, type TripCostKind } from "./trips";
export { shiftDays } from "./shared";
