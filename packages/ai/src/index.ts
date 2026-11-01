// Assistente com IA (ADR-0018). Só para o servidor: a chave nunca chega ao navegador.
export {
  aiLimits,
  assistantState,
  canUseAssistant,
  DEFAULT_FAMILY_DAILY_TOKENS,
  DEFAULT_MONTHLY_BUDGET_USD,
  monthSpend,
  readAssistantSettings,
  serviceDay,
  type AiLimits,
  type AssistantSettings,
  type AssistantState,
} from "./access";
export {
  assistantConfigured,
  createModelClient,
  modelBaseUrl,
  type ModelClient,
  type ModelMessage,
  type ModelStream,
  type StreamParams,
} from "./client";
export { checkModel, type ModelCheck } from "./check";
export {
  acceptDebtFiles,
  activateAssistant,
  deactivateAssistant,
  setAssistantAutonomy,
} from "./consent";
export {
  DEBT_ROUTE,
  debtFileGate,
  extractionParams,
  FILES_CONSENT_VERSION,
  readDebtDocument,
  sanitizeExtraction,
  type DebtReadResult,
  type ReadDebtDocumentInput,
} from "./debts/read-document";
export {
  INSIGHTS_CONSENT_VERSION,
  NIGHT_ROUTE,
  runNightlyInsights,
  type InsightRun,
} from "./insights/nightly";
export { rejectionOf } from "./insights/verify";
export { SYSTEM_PROMPT } from "./instructions";
export {
  echoContent,
  LIMIT_TEXT,
  REFUSAL_TEXT,
  requestParams,
  runChatTurn,
  type AssistantErrorCode,
  type AssistantEvent,
  type ChatTurnInput,
} from "./loop";
export { deleteAllMemories, deleteMemory, listMemories, type MemoryRow } from "./memories";
export {
  CHAT_ROUTE,
  costUsd,
  MODEL,
  PRICES,
  usageOf,
  type AiRoute,
  type ModelUsage,
} from "./models";
export { createPrivacyFilter, personLabels, type PrivacyFilter } from "./privacy";
export {
  deleteThread,
  listThreads,
  loadThread,
  type MessageStatus,
  type StoredMessage,
  type ThreadMessage,
} from "./threads";
export { ALL_TOOLS, apiToolsFor, executeTool, toolsFor, type AssistantTool } from "./tools";
export { knownNumbers, mentionsInvestment, uncheckedAmounts } from "./verify";
