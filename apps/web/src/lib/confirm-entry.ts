import "server-only";
import {
  accessWithin,
  accountCurrency,
  and,
  cardPurchaseImports,
  cardPurchases,
  cardStatementPayments,
  cashflowPlans,
  creditCards,
  currencyFrozen,
  debtInstallments,
  eq,
  inArray,
  goalContributions,
  goals,
  householdCurrency,
  incomeReceipts,
  incomeVacationReceipts,
  isSchemaLag,
  mainEntry,
  transactions,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  canUse,
  isForeign,
  isYearMonth,
  linesTotal,
  money,
  occurrenceDate,
  openIncomeEntries,
  purchaseLines,
  statementClosingDate,
  statementDueDate,
  statementMonthOf,
  addMonths,
  toDbAmount,
  type Currency,
  type EntryMoney,
} from "@organizeup/domain";
import { incomeReceiptRows } from "@organizeup/agents";
import { audit } from "./audit";
import { refreshCarry } from "./card-statements";
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

/**
 * O que aconteceu de verdade, quando difere do compromisso: a renda cadastrada é uma estimativa, e a fatura
 * pode ser paga em parte. Sem isto, vale o valor e a conta do próprio compromisso.
 */
export interface ActualPayment {
  amount?: string;
  accountId?: string;
}

/** Impressão digital da compra que leva o restante de uma fatura paga em parte para a fatura seguinte. */
export const carryMark = (statementMonth: string) => `saldo:${statementMonth}`;

const dayAfter = (date: string, days = 1) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Desfazer o pagamento de uma fatura leva junto o restante que ele tinha jogado para a fatura seguinte.
 * Chame antes de apagar os lançamentos: a ligação com a fatura some junto com eles.
 */
export async function removeStatementCarry(tx: TenantTx, transactionIds: string[]): Promise<void> {
  if (transactionIds.length === 0) return;
  const payments = await tx
    .select({
      cardId: cardStatementPayments.cardId,
      statementMonth: cardStatementPayments.statementMonth,
    })
    .from(cardStatementPayments)
    .where(inArray(cardStatementPayments.transactionId, transactionIds));
  for (const payment of payments) {
    // A marca do saldo mora numa coluna da 0051: antes de ela chegar, não há saldo para tirar.
    const carried = await tx
      .transaction((step) =>
        step
          .select({ id: cardPurchaseImports.id })
          .from(cardPurchaseImports)
          .where(
            and(
              eq(cardPurchaseImports.cardId, payment.cardId),
              eq(cardPurchaseImports.importFingerprint, carryMark(payment.statementMonth)),
            ),
          ),
      )
      .catch((error: unknown) => {
        if (isSchemaLag(error)) return [];
        throw error;
      });
    if (carried.length === 0) continue;
    await tx.delete(cardPurchases).where(
      inArray(
        cardPurchases.id,
        carried.map((row) => row.id),
      ),
    );
  }
}

/** Falta a cotação de uma conta estrangeira nesta data. Sai antes de qualquer gravação. */
class MissingQuote extends Error {
  constructor(
    readonly currency: Currency,
    readonly date: string,
  ) {
    super("sem_cotacao");
  }
}

/** A conta está numa moeda adicional que a família cancelou: fica só leitura. */
class FrozenCurrency extends Error {
  constructor(readonly currency: Currency) {
    super("moeda_cancelada");
  }
}

/** Compromisso na moeda principal, lançado na conta. Null só se a conta não existir mais. */
export async function commitmentEntry(
  tx: TenantTx,
  accountId: string,
  value: string,
  date: string,
): Promise<EntryMoney | null> {
  const currency = await accountCurrency(tx, accountId);
  if (currency && (await currencyFrozen(tx, currency))) throw new FrozenCurrency(currency);
  const entry = await mainEntry(tx, accountId, value, date);
  if (entry) return entry;
  if (currency && isForeign(currency, await householdCurrency(tx)))
    throw new MissingQuote(currency, date);
  return null;
}

/** Confirmou, não havia o que confirmar, ou faltou a cotação: aí a pessoa precisa de um aviso. */
export type ConfirmOutcome =
  | { done: boolean; missingQuote?: undefined; frozenCurrency?: undefined; moduleOff?: undefined }
  | {
      done: false;
      missingQuote: { currency: Currency; date: string };
      frozenCurrency?: undefined;
      moduleOff?: undefined;
    }
  | { done: false; missingQuote?: undefined; frozenCurrency: Currency; moduleOff?: undefined }
  | { done: false; missingQuote?: undefined; frozenCurrency?: undefined; moduleOff: true };

/**
 * Marca como pago ou recebido. `key` é `t:<lançamento>`, `p:<previsão>` (com `month`),
 * `d:<parcela>`, `f:<cartão>:<mês>`, `r:<renda>:<mês>:<parte>` ou `g:<meta>:<mês>`. Compromissos são
 * na moeda principal: pagos com conta estrangeira, convertem pela data, e sem cotação nada é confirmado.
 */
export async function confirmCommitment(
  tx: TenantTx,
  ctx: TenantContext,
  key: string,
  month: string,
  mark: ImportMark | Record<string, never> = {},
  receivedOn?: string,
  actual: ActualPayment = {},
): Promise<ConfirmOutcome> {
  // Parcela de dívida e de meta são dados de módulo: desligado, ficam guardadas, sem baixa.
  const owner = key.startsWith("d:") ? "dividas" : key.startsWith("g:") ? "metas" : null;
  if (owner && !canUse(await accessWithin(tx), owner)) return { done: false, moduleOff: true };
  try {
    return { done: await confirmByKey(tx, ctx, key, month, mark, receivedOn, actual) };
  } catch (error) {
    if (error instanceof FrozenCurrency) return { done: false, frozenCurrency: error.currency };
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
  receivedOn?: string,
  actual: ActualPayment = {},
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
    const total = linesTotal(lines);
    // Paga em parte, a fatura fecha com o que saiu da conta, e o restante vai para a seguinte.
    const paidAmount = actual.amount ?? total;
    if (!money(paidAmount).gt(0)) return false;
    const occurredOn = receivedOn ?? statementDueDate(statementMonth, card);
    const payingAccountId = actual.accountId ?? card.payingAccountId;
    const entry = await commitmentEntry(tx, payingAccountId, paidAmount, occurredOn);
    if (!entry) return false;
    const [created] = await tx
      .insert(transactions)
      .values({
        householdId: ctx.householdId,
        accountId: payingAccountId,
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
    const rest = money(total).minus(paidAmount);
    if (rest.gt(0)) {
      // O dia seguinte ao fechamento já é da fatura seguinte; em mês curto, anda mais um pouco.
      const next = addMonths(statementMonth, 1);
      let carryOn = dayAfter(statementClosingDate(statementMonth, card));
      for (let tries = 0; tries < 5 && statementMonthOf(carryOn, card) !== next; tries += 1) {
        carryOn = dayAfter(carryOn);
      }
      const [year, monthNumber] = statementMonth.split("-");
      const [carried] = await tx
        .insert(cardPurchases)
        .values({
          householdId: ctx.householdId,
          cardId,
          categoryId,
          description: `Saldo da fatura de ${monthNumber}/${year}`,
          amount: toDbAmount(rest),
          installments: 1,
          purchasedOn: carryOn,
          createdBy: ctx.userId,
        })
        .returning({ id: cardPurchases.id });
      await tx
        .update(cardPurchaseImports)
        .set({ importFingerprint: carryMark(statementMonth) })
        .where(eq(cardPurchaseImports.id, carried!.id));
    }
    // A fatura seguinte ganhou uma compra (o saldo): se ela já tem pagamento, o saldo dela é refeito (ADR-0043).
    if (rest.gt(0)) await refreshCarry(tx, ctx, card, statementMonth, "0.00");
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
    // `amount` fica igual nos dois lados, na moeda principal: é por ele que `goalEntryLink` acha a receita espelho.
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
    const { source, entry } = found;
    // Parte já baixada no ano não baixa de novo, mesmo em outro mês.
    if (openIncomeEntries([entry], await incomeReceiptRows(tx), [source]).length === 0)
      return false;
    const date = receivedOn ?? entry.date;
    // O banco mostra quanto caiu e em que conta: vale mais que a estimativa do cadastro.
    const incomeAccountId = actual.accountId ?? source.accountId;
    const received = actual.amount ?? entry.amount;
    if (!money(received).gt(0)) return false;
    const entryMoney = await commitmentEntry(tx, incomeAccountId, received, date);
    if (!entryMoney) return false;
    const [created] = await tx
      .insert(transactions)
      .values({
        householdId: ctx.householdId,
        accountId: incomeAccountId,
        categoryId: source.categoryId,
        kind: "receita",
        description: entry.description,
        ...entryMoney,
        occurredOn: date,
        status: "realizado",
        createdBy: ctx.userId,
        ...mark,
      })
      .returning({ id: transactions.id });
    const receipt = {
      householdId: ctx.householdId,
      incomeSourceId: sourceId,
      month: incomeMonth,
      transactionId: created!.id,
    };
    if (found.part === "ferias-2" || found.part === "ferias-3")
      await tx.insert(incomeVacationReceipts).values({ ...receipt, part: found.part });
    else await tx.insert(incomeReceipts).values({ ...receipt, part: found.part });
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
