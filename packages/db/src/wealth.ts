// Leituras e gravações de patrimônio usadas pela web e pelo worker. Rode dentro de withHousehold.
// As contas ficam em @organizeup/domain (summarizeNetWorth); aqui só saem os dados.
// Nas subconsultas, a tabela vai escrita: `${tabela.coluna}` num select de uma tabela só sai sem
// prefixo, e o banco resolveria a coluna na tabela interna.
import { eq, sql } from "drizzle-orm";
import { appPool } from "./client";
import {
  accounts,
  assets,
  cardPurchases,
  cardStatementPayments,
  creditCards,
  debts,
  household,
  householdSettings,
  netWorthSnapshots,
} from "./schema";
import type { TenantTx } from "./tenant";

/** Tudo que entra na conta do patrimônio líquido. */
export async function netWorthInputs(tx: TenantTx) {
  const [accountRows, assetRows, debtRows, cards, purchases, payments] = await Promise.all([
    tx
      .select({
        id: accounts.id,
        name: accounts.name,
        archived: accounts.archived,
        balance: sql<string>`(${accounts.openingBalance} + coalesce((
          select sum(case when t.kind = 'receita' then t.amount else -t.amount end)
          from transactions t
          where t.account_id = accounts.id and t.status = 'realizado'
        ), 0))::text`,
      })
      .from(accounts)
      .orderBy(accounts.createdAt),
    tx.select({ id: assets.id, value: assets.value }).from(assets),
    tx
      .select({
        id: debts.id,
        name: debts.name,
        archived: debts.archived,
        balance: sql<string>`coalesce((
          select sum(i.principal) from debt_installments i
          where i.debt_id = debts.id and i.transaction_id is null
        ), 0)::text`,
      })
      .from(debts)
      .orderBy(debts.createdAt),
    tx
      .select({
        id: creditCards.id,
        name: creditCards.name,
        closingDay: creditCards.closingDay,
        dueDay: creditCards.dueDay,
      })
      .from(creditCards),
    tx.select().from(cardPurchases),
    tx.select().from(cardStatementPayments),
  ]);
  return {
    accounts: accountRows,
    assets: assetRows,
    debts: debtRows,
    cards,
    purchases,
    paidStatements: payments.map((p) => `${p.cardId}:${p.statementMonth}`),
  };
}

/** Grava a foto do mês; a última do mês vale. */
export async function recordNetWorth(
  tx: TenantTx,
  householdId: string,
  month: string,
  values: { owned: string; owed: string; net: string },
): Promise<void> {
  await tx
    .insert(netWorthSnapshots)
    .values({ householdId, month, ...values })
    .onConflictDoUpdate({
      target: [netWorthSnapshots.householdId, netWorthSnapshots.month],
      set: { ...values, updatedAt: new Date() },
    });
}

export async function householdTimezone(tx: TenantTx, householdId: string) {
  const [settings] = await tx
    .select({ timezone: householdSettings.timezone })
    .from(householdSettings)
    .where(eq(householdSettings.householdId, householdId));
  return settings?.timezone;
}

/** Só identificadores, para jobs que percorrem as famílias uma a uma. */
export async function listHouseholdIds(): Promise<string[]> {
  const rows = await appPool().db.select({ id: household.id }).from(household);
  return rows.map((row) => row.id);
}
