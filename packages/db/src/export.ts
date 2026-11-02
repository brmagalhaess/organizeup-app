// Exportação dos dados da família (LGPD, art. 18). As chaves são os nomes das tabelas no banco.
// Tabela nova com household_id entra aqui; o teste de integração falha se faltar alguma.
import {
  accounts,
  aiUsage,
  assets,
  assistantMessages,
  assistantThreads,
  auditLog,
  calendarEvents,
  cardPurchases,
  cardStatementPayments,
  cashflowPlans,
  categories,
  categoryMemory,
  creditCards,
  debtDocumentMeta,
  debtDocuments,
  debtInstallments,
  debtPlanReports,
  debts,
  dividendGoals,
  dividends,
  earmarks,
  emergencyFund,
  goalContributions,
  goals,
  householdReports,
  householdSettings,
  householdStatements,
  accountTransfers,
  householdFileConsents,
  householdInsights,
  householdMemories,
  householdNotifications,
  householdSubscriptions,
  householdSuggestions,
  householdUsage,
  importBatches,
  incomeReceipts,
  incomeSources,
  investments,
  investmentStockEvents,
  investmentTargets,
  investmentTrades,
  netWorthSnapshots,
  people,
  retirementPlan,
  retirementScenarios,
  transactions,
  tripCosts,
  tripPeople,
  tripIntentions,
  trips,
} from "./schema";
import { isSchemaLag } from "./access";
import type { TenantTx } from "./tenant";

const HOUSEHOLD_TABLES = {
  people,
  household_settings: householdSettings,
  accounts,
  categories,
  cashflow_plans: cashflowPlans,
  import_batches: importBatches,
  transactions,
  credit_cards: creditCards,
  card_purchases: cardPurchases,
  card_statement_payments: cardStatementPayments,
  debts,
  debt_installments: debtInstallments,
  debt_plan_reports: debtPlanReports,
  household_file_consents: householdFileConsents,
  emergency_fund: emergencyFund,
  earmarks,
  assets,
  net_worth_snapshots: netWorthSnapshots,
  calendar_events: calendarEvents,
  income_sources: incomeSources,
  income_receipts: incomeReceipts,
  investments,
  investment_trades: investmentTrades,
  investment_stock_events: investmentStockEvents,
  investment_targets: investmentTargets,
  dividends,
  dividend_goals: dividendGoals,
  category_memory: categoryMemory,
  household_reports: householdReports,
  household_statements: householdStatements,
  retirement_scenarios: retirementScenarios,
  trips,
  trip_costs: tripCosts,
  trip_people: tripPeople,
  retirement_plan: retirementPlan,
  goals,
  goal_contributions: goalContributions,
  household_suggestions: householdSuggestions,
  household_notifications: householdNotifications,
  account_transfers: accountTransfers,
  household_insights: householdInsights,
  household_memories: householdMemories,
  assistant_threads: assistantThreads,
  assistant_messages: assistantMessages,
  ai_usage: aiUsage,
  audit_log: auditLog,
};

/** Tabelas das migrações 0036 e 0039. Sem elas ainda, exportar segue: cada uma lê no próprio savepoint. */
const LATE_TABLES = {
  household_subscriptions: householdSubscriptions,
  household_usage: householdUsage,
  trip_intentions: tripIntentions,
};

/** Arquivo inteiro deixaria a exportação gigante: vão os metadados, e a tela baixa cada um. */
export const DEBT_DOCUMENT_EXPORT_NOTE =
  "O conteúdo do arquivo não entra na exportação. Baixe cada arquivo na tela de Dívidas.";

/**
 * Tudo o que a RLS deixa o contexto ler. A auditoria só aparece para o responsável, e as conversas
 * com o assistente, só para quem conversou.
 */
export async function exportHousehold(tx: TenantTx): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const [name, table] of Object.entries(HOUSEHOLD_TABLES)) {
    out[name] = await tx.select().from(table as typeof people);
  }
  for (const [name, table] of Object.entries(LATE_TABLES)) {
    out[name] = await tx
      .transaction((step) => step.select().from(table as typeof householdUsage))
      .catch((error: unknown) => {
        if (isSchemaLag(error)) return [];
        throw error;
      });
  }
  const documents = await tx.select(debtDocumentMeta).from(debtDocuments);
  out.debt_documents = documents.map((row) => ({ ...row, content: DEBT_DOCUMENT_EXPORT_NOTE }));
  return out;
}
