// Exportação dos dados da família (LGPD, art. 18). As chaves são os nomes das tabelas no banco.
// Tabela nova com household_id entra aqui; o teste de integração falha se faltar alguma.
import {
  accounts,
  assets,
  auditLog,
  calendarEvents,
  cardPurchases,
  cardStatementPayments,
  cashflowPlans,
  categories,
  creditCards,
  debtInstallments,
  debts,
  dividendGoals,
  dividends,
  earmarks,
  emergencyFund,
  householdSettings,
  importBatches,
  incomeReceipts,
  incomeSources,
  investments,
  investmentTargets,
  investmentTrades,
  netWorthSnapshots,
  people,
  transactions,
} from "./schema";
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
  emergency_fund: emergencyFund,
  earmarks,
  assets,
  net_worth_snapshots: netWorthSnapshots,
  calendar_events: calendarEvents,
  income_sources: incomeSources,
  income_receipts: incomeReceipts,
  investments,
  investment_trades: investmentTrades,
  investment_targets: investmentTargets,
  dividends,
  dividend_goals: dividendGoals,
  audit_log: auditLog,
};

/** Tudo o que a RLS deixa o contexto ler. A auditoria só aparece para o responsável. */
export async function exportHousehold(tx: TenantTx): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const [name, table] of Object.entries(HOUSEHOLD_TABLES)) {
    out[name] = await tx.select().from(table as typeof people);
  }
  return out;
}
