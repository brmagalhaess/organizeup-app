// API pública dos agentes do produto (ADR-0015/0016). Tudo roda dentro de um TenantTx recebido.
export {
  applySuggestion,
  dismissSuggestion,
  recordDividendRemoval,
  undoSuggestion,
  type ApplyResult,
} from "./apply";
export {
  BRAPI_SOURCE,
  fetchBrapiQuote,
  fetchFiiDividends,
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
export { calendarMonth } from "./calendar-view";
export { monthlyPlanView } from "./plan-view";
export { currentDividendPlan } from "./retirement-view";
export {
  DEFAULT_RETIREMENT_AGE,
  dividendPlanInputs,
  loadFiscalTables,
  reserveInputs,
  savingsCategoryIds,
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
export { CATEGORIAS_AGENT, runCategoriasAgent } from "./run-categorias";
export {
  CLASS_DEVIATION_POINTS,
  INVESTIMENTOS_AGENT,
  runInvestimentosAgent,
} from "./run-investimentos";
export { METAS_AGENT, runMetasAgent } from "./run-metas";
export { loadDestinations, runViagensAgent, VIAGENS_AGENT } from "./run-viagens";
export {
  ASSET_CLASS_LABELS,
  IGNORED_DAYS,
  recordAudit,
  resolveAllocation,
  REVIEW_DAYS,
  STALE_PRICE_DAYS,
  type AgentInput,
  type AgentResult,
} from "./shared";
export {
  amountSchema,
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
export { createTrip, type CreateTripInput, type TripCostKind } from "./trips";
export { shiftDays } from "./shared";
