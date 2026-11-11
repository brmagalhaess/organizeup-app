// Exportação dos dados da família (LGPD, art. 18). As chaves são os nomes das tabelas no banco.
// Tabela nova com household_id entra aqui; o teste de integração falha se faltar alguma.
import {
  accounts,
  aiUsage,
  assets,
  assistantMessages,
  assistantThreads,
  auditLog,
  bankConnectionAccounts,
  bankConnections,
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
  vipGrants,
  importBatches,
  incomeReceipts,
  incomeVacationReceipts,
  incomeYearPlans,
  incomeSources,
  investments,
  investmentStockEvents,
  investmentTargets,
  investmentTrades,
  netWorthSnapshots,
  people,
  retirementPlan,
  retirementScenarios,
  householdFileScopes,
  smartImportFileMeta,
  smartImportFiles,
  smartImportItems,
  smartImports,
  transactions,
  tripCosts,
  tripPeople,
  tripIntentions,
  trips,
} from "./schema";
import { getTableColumns, getTableName, sql } from "drizzle-orm";
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

/** Tabelas das migrações 0036, 0038, 0039, 0040 e 0042. Sem elas ainda, exportar segue: cada uma lê no próprio savepoint. */
const LATE_TABLES = {
  household_subscriptions: householdSubscriptions,
  household_usage: householdUsage,
  vip_grants: vipGrants,
  trip_intentions: tripIntentions,
  household_file_scopes: householdFileScopes,
  smart_imports: smartImports,
  smart_import_items: smartImportItems,
  income_year_plans: incomeYearPlans,
  income_vacation_receipts: incomeVacationReceipts,
  bank_connection_accounts: bankConnectionAccounts,
};

/** Arquivo inteiro deixaria a exportação gigante: vão os metadados, e a tela baixa cada um. */
export const DEBT_DOCUMENT_EXPORT_NOTE =
  "O conteúdo do arquivo não entra na exportação. Baixe cada arquivo na tela de Dívidas.";

/** As chaves da Pluggy são segredo da pessoa: nem cifradas saem do banco (ADR-0038). */
export const BANK_KEYS_EXPORT_NOTE =
  "As chaves da conexão não entram na exportação. Elas ficam no painel da Pluggy de quem conectou.";

const bankConnectionMeta = {
  id: bankConnections.id,
  householdId: bankConnections.householdId,
  userId: bankConnections.userId,
  personId: bankConnections.personId,
  provider: bankConnections.provider,
  itemIds: bankConnections.itemIds,
  checkedAt: bankConnections.checkedAt,
  errorCode: bankConnections.errorCode,
  createdAt: bankConnections.createdAt,
  updatedAt: bankConnections.updatedAt,
};

export const SMART_FILE_EXPORT_NOTE =
  "O conteúdo do arquivo não entra na exportação. Baixe cada arquivo em Importar arquivos.";

/**
 * Tudo o que a RLS deixa o contexto ler. A auditoria só aparece para o responsável, e as conversas
 * com o assistente, só para quem conversou.
 */
/**
 * Tabela que já existe, mas ainda sem uma coluna nova (web à frente da migração, ADR-0023): exporta as
 * colunas que o banco tem, em vez de derrubar a exportação inteira. O savepoint segura o erro.
 */
async function selectPresentColumns(tx: TenantTx, table: typeof people): Promise<unknown[]> {
  try {
    return await tx.transaction((step) => step.select().from(table));
  } catch (error) {
    if (!isSchemaLag(error)) throw error;
    const result = await tx.execute(
      sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${getTableName(table)}`,
    );
    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Array<{
      column_name: string;
    }>;
    const present = new Set(rows.map((row) => row.column_name));
    const columns = Object.fromEntries(
      Object.entries(getTableColumns(table)).filter(([, column]) => present.has(column.name)),
    );
    if (Object.keys(columns).length === 0) return [];
    return tx.transaction((step) => step.select(columns).from(table));
  }
}

export async function exportHousehold(tx: TenantTx): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const [name, table] of Object.entries(HOUSEHOLD_TABLES)) {
    out[name] = await selectPresentColumns(tx, table as typeof people);
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
  // Como nos anexos de dívida: metadados e o que foi lido, sem o arquivo.
  out.smart_import_files = await tx
    .transaction(async (step) => {
      const files = await step.select(smartImportFileMeta).from(smartImportFiles);
      return files.map((row) => ({ ...row, content: SMART_FILE_EXPORT_NOTE }));
    })
    .catch((error: unknown) => {
      if (isSchemaLag(error)) return [];
      throw error;
    });
  out.bank_connections = await tx
    .transaction(async (step) => {
      const connections = await step.select(bankConnectionMeta).from(bankConnections);
      return connections.map((row) => ({ ...row, keys: BANK_KEYS_EXPORT_NOTE }));
    })
    .catch((error: unknown) => {
      if (isSchemaLag(error)) return [];
      throw error;
    });
  return out;
}
