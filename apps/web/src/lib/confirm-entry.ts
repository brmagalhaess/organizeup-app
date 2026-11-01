import "server-only";
import {
  accountCurrency,
  and,
  cardPurchases,
  cardStatementPayments,
  cashflowPlans,
  creditCards,
  debtInstallments,
  eq,
  goalContributions,
  goals,
  incomeReceipts,
  reaisEntry,
  transactions,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  isForeign,
  isYearMonth,
  linesTotal,
  money,
  occurrenceDate,
  purchaseLines,
  statementDueDate,
  toDbAmount,
  type EntryMoney,
  type FxCurrency,
} from "@organizeup/domain";
import { audit } from "./audit";
import {
  goalEntryDescription,
  openGoalContribution,
  openInstallment,
  systemCategories,
} from "./commitments";
import { incomeOccurrence } from "./income-data";

/** Liga o lançamento à linha do extrato que deu a baixa. */
export interface ImportMark {
  importFingerprint: string;
  importBatchId: string;
}

/** Falta a cotação de uma conta estrangeira nesta data. Sai antes de qualquer gravação. */
class MissingQuote extends Error {
  constructor(
    readonly currency: FxCurrency,
    readonly date: string,
  ) {
    super("sem_cotacao");
  }
}

/** Compromisso em reais na conta. Null só se a conta não existir mais. */
async function commitmentEntry(
  tx: TenantTx,
  accountId: string,
  reais: string,
  date: string,
): Promise<EntryMoney | null> {
  const entry = await reaisEntry(tx, accountId, reais, date);
  if (entry) return entry;
  const currency = await accountCurrency(tx, accountId);
  if (currency && isForeign(currency)) throw new MissingQuote(currency, date);
  return null;
}

/** Confirmou, não havia o que confirmar, ou faltou a cotação: aí a pessoa precisa de um aviso. */
export type ConfirmOutcome =
  | { done: boolean; missingQuote?: undefined }
  | { done: false; missingQuote: { currency: FxCurrency; date: string } };

/**
 * Marca como pago ou recebido. `key` é `t:<lançamento>`, `p:<previsão>` (com `month`),
 * `d:<parcela>`, `f:<cartão>:<mês>`, `r:<renda>:<mês>:<parte>` ou `g:<meta>:<mês>`. Compromissos são
 * em reais: pagos com conta estrangeira, convertem pela data, e sem cotação nada é confirmado.
 */
export async function confirmCommitment(
  tx: TenantTx,
  ctx: TenantContext,
  key: string,
  month: string,
  mark: ImportMark | Record<string, never> = {},
): Promise<ConfirmOutcome> {
  try {
    return { done: await confirmByKey(tx, ctx, key, month, mark) };
  } catch (error) {
    if (!(error instanceof MissingQuote)) throw error;
    return { done: false, missingQuote: { currency: error.currency, date: error.date } };
  }
}

async function confirmByKey(
  tx: TenantTx,
  ctx: TenantContext,
  key: string,
  month: string,
  mark: ImportMark | Record<string, never>,
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
    const occurredOn = occurrenceDate(plan.dayOfMonth, month);
    const entry = await commitmentEntry(tx, plan.accountId, plan.amount, occurredOn);
    if (!entry) return false;
    const created = await tx
      .insert(transactions)
      .values({
        householdId: ctx.householdId,
        accountId: plan.accountId,
        categoryId: plan.categoryId,
        kind: plan.kind,
        description: plan.description,
        ...entry,
        occurredOn,
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
    const entry = await commitmentEntry(
      tx,
      debt.accountId,
      installment.amount,
      installment.dueDate,
    );
    if (!entry) return false;
    const [created] = await tx
      .insert(transactions)
      .values({
        householdId: ctx.householdId,
        accountId: debt.accountId,
        categoryId,
        kind: "despesa",
        description: `${debt.name} (${installment.number}/${total})`,
        ...entry,
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
    const occurredOn = statementDueDate(statementMonth, card);
    const entry = await commitmentEntry(tx, card.payingAccountId, linesTotal(lines), occurredOn);
    if (!entry) return false;
    const [created] = await tx
      .insert(transactions)
      .values({
        householdId: ctx.householdId,
        accountId: card.payingAccountId,
        categoryId,
        kind: "despesa",
        description: `Fatura ${card.name}`,
        ...entry,
        occurredOn,
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

  if (key.startsWith("g:")) {
    const [, goalId = "", goalMonth = ""] = key.split(":");
    if (!isYearMonth(goalMonth)) return false;
    const open = await openGoalContribution(tx, goalId, goalMonth);
    const { goal: categoryId, goalIncome } = await systemCategories(tx);
    if (!open || !categoryId) return false;
    const { contribution, goal, number, total } = open;
    const { accountId } = goal;
    if (!accountId || (goal.destinationAccountId && !goalIncome)) return false;
    const occurredOn = occurrenceDate(goal.planDay, goalMonth);
    const common = {
      householdId: ctx.householdId,
      description: goalEntryDescription(goal.name, number, total),
      occurredOn,
      status: "realizado" as const,
      createdBy: ctx.userId,
    };
    // `amount` fica igual nos dois lados, em reais: é por ele que `goalEntryLink` acha a receita espelho.
    const entry = await commitmentEntry(tx, accountId, contribution.amount, occurredOn);
    const mirror = goal.destinationAccountId
      ? await commitmentEntry(tx, goal.destinationAccountId, contribution.amount, occurredOn)
      : null;
    if (!entry || (goal.destinationAccountId && !mirror)) return false;
    const [created] = await tx
      .insert(transactions)
      .values({ ...common, ...entry, accountId, categoryId, kind: "despesa", ...mark })
      .returning({ id: transactions.id });
    if (goal.destinationAccountId && goalIncome) {
      await tx.insert(transactions).values({
        ...common,
        ...mirror!,
        accountId: goal.destinationAccountId,
        categoryId: goalIncome,
        kind: "receita",
      });
    }
    await tx
      .update(goalContributions)
      .set({ transactionId: created!.id })
      .where(eq(goalContributions.id, contribution.id));
    const saved = money(goal.saved).plus(contribution.amount);
    await tx
      .update(goals)
      .set({
        saved: toDbAmount(saved),
        status: saved.gte(goal.targetAmount) ? "concluida" : goal.status,
        updatedAt: new Date(),
      })
      .where(eq(goals.id, goal.id));
    await audit(tx, ctx, "confirm", "goal_contributions", contribution.id);
    return true;
  }

  if (key.startsWith("r:")) {
    const [, sourceId = "", incomeMonth = "", part = ""] = key.split(":");
    if (!isYearMonth(incomeMonth)) return false;
    const found = await incomeOccurrence(tx, sourceId, incomeMonth, part);
    if (!found) return false;
    const [received] = await tx
      .select({ id: incomeReceipts.id })
      .from(incomeReceipts)
      .where(
        and(
          eq(incomeReceipts.incomeSourceId, sourceId),
          eq(incomeReceipts.month, incomeMonth),
          eq(incomeReceipts.part, found.part),
        ),
      );
    if (received) return false;
    const { source, entry } = found;
    const entryMoney = await commitmentEntry(tx, source.accountId, entry.amount, entry.date);
    if (!entryMoney) return false;
    const [created] = await tx
      .insert(transactions)
      .values({
        householdId: ctx.householdId,
        accountId: source.accountId,
        categoryId: source.categoryId,
        kind: "receita",
        description: entry.description,
        ...entryMoney,
        occurredOn: entry.date,
        status: "realizado",
        createdBy: ctx.userId,
        ...mark,
      })
      .returning({ id: transactions.id });
    await tx.insert(incomeReceipts).values({
      householdId: ctx.householdId,
      incomeSourceId: sourceId,
      month: incomeMonth,
      part: found.part,
      transactionId: created!.id,
    });
    await audit(tx, ctx, "confirm", "income_receipts", sourceId);
    return true;
  }

  return false;
}

/**
 * Se o lançamento veio de uma parcela de meta, diz qual meta e quanto, e devolve os dois lados: a
 * despesa ligada à parcela e a receita espelho na conta destino, que não tem ligação própria e é
 * achada pela mesma descrição, valor e data.
 */
export async function goalEntryLink(tx: TenantTx, id: string) {
  const [entry] = await tx.select().from(transactions).where(eq(transactions.id, id));
  if (!entry) return null;
  const { goal, goalIncome } = await systemCategories(tx);
  const twin = async (kind: "despesa" | "receita", categoryId: string | undefined) => {
    if (!categoryId) return undefined;
    const [row] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.kind, kind),
          eq(transactions.categoryId, categoryId),
          eq(transactions.description, entry.description),
          eq(transactions.amount, entry.amount),
          eq(transactions.occurredOn, entry.occurredOn),
        ),
      );
    return row?.id;
  };

  const isIncome = entry.kind === "receita";
  if (isIncome && entry.categoryId !== goalIncome) return null;
  const expenseId = isIncome ? await twin("despesa", goal) : entry.id;
  if (!expenseId) return null;
  const [contribution] = await tx
    .select({ goalId: goalContributions.goalId, amount: goalContributions.amount })
    .from(goalContributions)
    .where(eq(goalContributions.transactionId, expenseId));
  if (!contribution) return null;
  const incomeId = isIncome ? entry.id : await twin("receita", goalIncome);
  return {
    ...contribution,
    transactionIds: incomeId ? [expenseId, incomeId] : [expenseId],
  };
}

/** Devolve à meta o que saiu com um lançamento de parcela apagado. */
export async function reverseGoalSaved(
  tx: TenantTx,
  ctx: TenantContext,
  link: { goalId: string; amount: string },
): Promise<void> {
  const [goal] = await tx.select().from(goals).where(eq(goals.id, link.goalId)).for("update");
  if (!goal) return;
  const rest = money(goal.saved).minus(link.amount);
  const saved = rest.gt(0) ? rest : money(0);
  await tx
    .update(goals)
    .set({
      saved: toDbAmount(saved),
      status: goal.status === "concluida" && saved.lt(goal.targetAmount) ? "juntando" : goal.status,
      updatedAt: new Date(),
    })
    .where(eq(goals.id, goal.id));
  await audit(tx, ctx, "update", "goals", goal.id);
}
