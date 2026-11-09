// Limpeza de dados por módulo (ADR-0034). Roda no tx da família, com a RLS: só apaga o que é dela.
// A lista de módulos e o que um puxa junto ficam em @organizeup/domain (`expandWipeScopes`); aqui está a
// ordem de apagar, filhos antes dos pais, e o soltar das referências que ficam (parcela paga sem o
// lançamento, bem sem a dívida, viagem sem o evento da agenda).
import { expandWipeScopes, type WipeScope } from "@organizeup/domain";
import { isNotNull, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { ensureFinanceDefaults } from "./finance";
import {
  accountTransfers,
  accounts,
  assets,
  calendarEvents,
  cardPurchases,
  cardStatementPayments,
  cashflowPlans,
  categories,
  creditCards,
  debtInstallments,
  debtPlanReports,
  debts,
  dividendGoals,
  earmarks,
  emergencyFund,
  goalContributions,
  goals,
  householdInsights,
  householdNotifications,
  householdReports,
  householdSettings,
  householdStatements,
  householdSuggestions,
  importBatches,
  incomeReceipts,
  incomeSources,
  incomeVacationReceipts,
  investmentTargets,
  investmentTrades,
  investments,
  netWorthSnapshots,
  retirementPlan,
  retirementScenarios,
  smartImports,
  transactions,
  tripIntentions,
  trips,
} from "./schema";
import type { TenantTx } from "./tenant";

export type WipeReport = {
  scopes: WipeScope[];
  /** Linhas apagadas por tabela, só das tabelas tocadas diretamente (a cascata não entra). */
  removed: Record<string, number>;
};

async function wipeTable(tx: TenantTx, report: WipeReport, name: string, table: PgTable) {
  const rows = await tx.delete(table).returning({ one: sql<number>`1` });
  report.removed[name] = (report.removed[name] ?? 0) + rows.length;
}

/**
 * Apaga os módulos escolhidos, e só eles, dentro de uma transação da família. Pessoas, membros, ajustes
 * da família, memórias do assistente e assinatura ficam. Com "contas", recria as contas e categorias
 * padrão no fim, para a família não abrir uma tela vazia que não funciona.
 */
export async function wipeHouseholdData(
  tx: TenantTx,
  input: { householdId: string; scopes: Iterable<WipeScope> },
): Promise<WipeReport> {
  const scopes = expandWipeScopes(input.scopes);
  const has = (scope: WipeScope) => scopes.includes(scope);
  const report: WipeReport = { scopes, removed: {} };

  if (has("lancamentos")) {
    // Quem aponta para o lançamento e continua existindo perde só o vínculo.
    await tx
      .update(goalContributions)
      .set({ transactionId: null })
      .where(isNotNull(goalContributions.transactionId));
    await tx
      .update(debtInstallments)
      .set({ transactionId: null })
      .where(isNotNull(debtInstallments.transactionId));
    await tx
      .update(investmentTrades)
      .set({ transactionId: null })
      .where(isNotNull(investmentTrades.transactionId));
    // Recibos de renda e pagamentos de fatura caem em cascata com o lançamento.
    await wipeTable(tx, report, "transactions", transactions);
    await wipeTable(tx, report, "account_transfers", accountTransfers);
    await wipeTable(tx, report, "import_batches", importBatches);
    await wipeTable(tx, report, "cashflow_plans", cashflowPlans);
  }
  if (has("cartoes")) {
    await wipeTable(tx, report, "card_statement_payments", cardStatementPayments);
    await wipeTable(tx, report, "card_purchases", cardPurchases);
    await wipeTable(tx, report, "credit_cards", creditCards);
  }
  if (has("renda")) {
    await wipeTable(tx, report, "income_receipts", incomeReceipts);
    await wipeTable(tx, report, "income_vacation_receipts", incomeVacationReceipts);
    // Planos do ano caem em cascata.
    await wipeTable(tx, report, "income_sources", incomeSources);
  }
  if (has("investimentos")) {
    // Operações, eventos e proventos caem em cascata.
    await wipeTable(tx, report, "investments", investments);
    await wipeTable(tx, report, "investment_targets", investmentTargets);
    await wipeTable(tx, report, "dividend_goals", dividendGoals);
  }
  if (has("dividas")) {
    await tx.update(assets).set({ linkedDebtId: null }).where(isNotNull(assets.linkedDebtId));
    // Parcelas e documentos caem em cascata.
    await wipeTable(tx, report, "debts", debts);
    await wipeTable(tx, report, "debt_plan_reports", debtPlanReports);
  }
  if (has("metas")) {
    // Parcelas do plano caem em cascata.
    await wipeTable(tx, report, "goals", goals);
  }
  if (has("viagens")) {
    await wipeTable(tx, report, "trip_intentions", tripIntentions);
    // Custos e pessoas da viagem caem em cascata.
    await wipeTable(tx, report, "trips", trips);
  }
  if (has("aposentadoria")) {
    await wipeTable(tx, report, "retirement_scenarios", retirementScenarios);
    await wipeTable(tx, report, "retirement_plan", retirementPlan);
  }
  if (has("patrimonio")) {
    await wipeTable(tx, report, "assets", assets);
    await wipeTable(tx, report, "emergency_fund", emergencyFund);
    await wipeTable(tx, report, "earmarks", earmarks);
    await wipeTable(tx, report, "net_worth_snapshots", netWorthSnapshots);
  }
  if (has("agenda")) {
    await tx
      .update(trips)
      .set({ calendarEventId: null })
      .where(isNotNull(trips.calendarEventId));
    await tx
      .update(householdSettings)
      .set({ weddingEventId: null })
      .where(isNotNull(householdSettings.weddingEventId));
    await wipeTable(tx, report, "calendar_events", calendarEvents);
  }
  if (has("importacoes")) {
    // Arquivos e itens caem em cascata.
    await wipeTable(tx, report, "smart_imports", smartImports);
  }
  if (has("relatorios")) {
    await wipeTable(tx, report, "household_notifications", householdNotifications);
    await wipeTable(tx, report, "household_suggestions", householdSuggestions);
    await wipeTable(tx, report, "household_insights", householdInsights);
    await wipeTable(tx, report, "household_reports", householdReports);
    await wipeTable(tx, report, "household_statements", householdStatements);
  }
  if (has("contas")) {
    // Por último: tudo que apontava para contas e categorias já foi (ver WIPE_REQUIRES).
    await wipeTable(tx, report, "accounts", accounts);
    await wipeTable(tx, report, "categories", categories);
    await ensureFinanceDefaults(tx, input.householdId);
  }
  return report;
}
