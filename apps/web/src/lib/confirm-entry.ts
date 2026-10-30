import "server-only";
import {
  and,
  cardPurchases,
  cardStatementPayments,
  cashflowPlans,
  creditCards,
  debtInstallments,
  eq,
  transactions,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  isYearMonth,
  linesTotal,
  occurrenceDate,
  purchaseLines,
  statementDueDate,
} from "@organizeup/domain";
import { audit } from "./audit";
import { openInstallment, systemCategories } from "./commitments";

/** Liga o lançamento à linha do extrato que deu a baixa. */
export interface ImportMark {
  importFingerprint: string;
  importBatchId: string;
}

/**
 * Marca como pago ou recebido. `key` é `t:<lançamento>`, `p:<previsão>` (com `month`),
 * `d:<parcela>` ou `f:<cartão>:<mês>`. Devolve se algo foi confirmado.
 */
export async function confirmCommitment(
  tx: TenantTx,
  ctx: TenantContext,
  key: string,
  month: string,
  mark: ImportMark | Record<string, never> = {},
): Promise<boolean> {
  const id = key.slice(2);

  if (key.startsWith("t:")) {
    const updated = await tx
      .update(transactions)
      .set({ status: "realizado", updatedAt: new Date(), ...mark })
      .where(and(eq(transactions.id, id), eq(transactions.status, "previsto")))
      .returning({ id: transactions.id });
    if (updated.length === 0) return false;
    await audit(tx, ctx, "confirm", "transactions", id);
    return true;
  }

  if (key.startsWith("p:") && isYearMonth(month)) {
    const [plan] = await tx.select().from(cashflowPlans).where(eq(cashflowPlans.id, id));
    if (!plan) return false;
    const created = await tx
      .insert(transactions)
      .values({
        householdId: ctx.householdId,
        accountId: plan.accountId,
        categoryId: plan.categoryId,
        kind: plan.kind,
        description: plan.description,
        amount: plan.amount,
        occurredOn: occurrenceDate(plan.dayOfMonth, month),
        status: "realizado",
        planId: plan.id,
        planMonth: month,
        createdBy: ctx.userId,
        ...mark,
      })
      .onConflictDoNothing()
      .returning({ id: transactions.id });
    if (created.length === 0) return false;
    await audit(tx, ctx, "confirm", "cashflow_plans", id);
    return true;
  }

  if (key.startsWith("d:")) {
    const open = await openInstallment(tx, id);
    const { debt: categoryId } = await systemCategories(tx);
    if (!open || !categoryId) return false;
    const { installment, debt, total } = open;
    const [created] = await tx
      .insert(transactions)
      .values({
        householdId: ctx.householdId,
        accountId: debt.accountId,
        categoryId,
        kind: "despesa",
        description: `${debt.name} (${installment.number}/${total})`,
        amount: installment.amount,
        occurredOn: installment.dueDate,
        status: "realizado",
        createdBy: ctx.userId,
        ...mark,
      })
      .returning({ id: transactions.id });
    await tx
      .update(debtInstallments)
      .set({ transactionId: created!.id })
      .where(eq(debtInstallments.id, id));
    await audit(tx, ctx, "confirm", "debt_installments", id);
    return true;
  }

  if (key.startsWith("f:")) {
    const [, cardId = "", statementMonth = ""] = key.split(":");
    if (!isYearMonth(statementMonth)) return false;
    const [card] = await tx.select().from(creditCards).where(eq(creditCards.id, cardId));
    const { card: categoryId } = await systemCategories(tx);
    if (!card || !categoryId) return false;
    const [paid] = await tx
      .select({ id: cardStatementPayments.id })
      .from(cardStatementPayments)
      .where(
        and(
          eq(cardStatementPayments.cardId, cardId),
          eq(cardStatementPayments.statementMonth, statementMonth),
        ),
      );
    if (paid) return false;
    const purchases = await tx.select().from(cardPurchases).where(eq(cardPurchases.cardId, cardId));
    const lines = purchases
      .flatMap((purchase) => purchaseLines(purchase, card))
      .filter((line) => line.statementMonth === statementMonth);
    if (lines.length === 0) return false;
    const [created] = await tx
      .insert(transactions)
      .values({
        householdId: ctx.householdId,
        accountId: card.payingAccountId,
        categoryId,
        kind: "despesa",
        description: `Fatura ${card.name}`,
        amount: linesTotal(lines),
        occurredOn: statementDueDate(statementMonth, card),
        status: "realizado",
        createdBy: ctx.userId,
        ...mark,
      })
      .returning({ id: transactions.id });
    await tx.insert(cardStatementPayments).values({
      householdId: ctx.householdId,
      cardId,
      statementMonth,
      transactionId: created!.id,
    });
    await audit(tx, ctx, "confirm", "card_statement_payments", cardId);
    return true;
  }

  return false;
}
