import "server-only";
import {
  cardBook,
  currentDebtPlan,
  listDebtDocuments,
  type DebtPlanView,
} from "@organizeup/agents";
import {
  accounts,
  and,
  asc,
  categories,
  debtInstallments,
  debts,
  eq,
  goalContributions,
  goals,
  householdSettings,
  isNull,
  tolerateSchemaLag,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  linesTotal,
  money,
  statementMonthOf,
  toDbAmount,
  todayIn,
  yearMonthOf,
  type StatementLine,
  type YearMonth,
} from "@organizeup/domain";

import { reportActionFailure } from "./diagnostics";

export { goalEntryDescription, loadCommitments, systemCategories } from "@organizeup/agents";

async function todayOf(tx: TenantTx, householdId: string) {
  const [settings] = await tx
    .select({ timezone: householdSettings.timezone })
    .from(householdSettings)
    .where(eq(householdSettings.householdId, householdId));
  return todayIn(settings?.timezone);
}

export type CardLine = StatementLine & { categoryName: string; locked: boolean };

/** Dados da tela de cartões. */
export async function loadCards(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const today = await todayOf(tx, ctx.householdId);
    const book = await cardBook(tx);
    const categoryRows = await tx
      .select({ id: categories.id, name: categories.name })
      .from(categories);
    const names = new Map(categoryRows.map((c) => [c.id, c.name]));
    const accountRows = await tx
      .select({ id: accounts.id, name: accounts.name, archived: accounts.archived })
      .from(accounts)
      .orderBy(asc(accounts.createdAt));

    const cards = book.map(({ card, lines, paid }) => {
      const openMonth = statementMonthOf(today, card);
      const locked = new Set(
        lines.filter((line) => paid.has(line.statementMonth)).map((line) => line.purchaseId),
      );
      const used = linesTotal(lines.filter((line) => !paid.has(line.statementMonth)));
      return {
        id: card.id,
        name: card.name,
        closingDay: card.closingDay,
        dueDay: card.dueDay,
        limitAmount: card.limitAmount,
        payingAccountId: card.payingAccountId,
        archived: card.archived,
        openMonth,
        openTotal: linesTotal(lines.filter((line) => line.statementMonth === openMonth)),
        used,
        available: card.limitAmount ? toDbAmount(money(card.limitAmount).minus(used)) : null,
        paidMonths: [...paid],
        lines: lines.map((line): CardLine => ({
          ...line,
          categoryName: names.get(line.categoryId) ?? "Sem categoria",
          locked: locked.has(line.purchaseId),
        })),
      };
    });
    return { today, cards, accounts: accountRows };
  });
}

/** Dados da tela de dívidas. */
export async function loadDebts(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const today = await todayOf(tx, ctx.householdId);
    const debtRows = await tx.select().from(debts).orderBy(asc(debts.createdAt));
    const rows = await tx.select().from(debtInstallments).orderBy(asc(debtInstallments.number));
    const accountRows = await tx
      .select({ id: accounts.id, name: accounts.name, archived: accounts.archived })
      .from(accounts)
      .orderBy(asc(accounts.createdAt));

    const views = debtRows.map((debt) => {
      const installments = rows
        .filter((row) => row.debtId === debt.id)
        .map((row) => ({
          id: row.id,
          number: row.number,
          dueDate: row.dueDate,
          amount: row.amount,
          principal: row.principal,
          interest: row.interest,
          paid: row.transactionId !== null,
        }));
      const open = installments.filter((row) => !row.paid);
      const sum = (field: "principal" | "interest") =>
        toDbAmount(open.reduce((acc, row) => acc.plus(row[field]), money(0)));
      return {
        id: debt.id,
        name: debt.name,
        system: debt.system,
        monthlyRate: debt.monthlyRate,
        accountId: debt.accountId,
        archived: debt.archived,
        installments,
        paidCount: installments.length - open.length,
        balance: sum("principal"),
        interestLeft: sum("interest"),
        next: open[0] ?? null,
      };
    });

    const active = views.filter((debt) => !debt.archived);
    const month = yearMonthOf(today);
    const openRows = active.flatMap((debt) => debt.installments.filter((row) => !row.paid));
    const total = (values: string[]) =>
      toDbAmount(values.reduce((acc, value) => acc.plus(value), money(0)));
    return {
      today,
      debts: views,
      accounts: accountRows,
      summary: {
        balance: total(active.map((debt) => debt.balance)),
        interestLeft: total(active.map((debt) => debt.interestLeft)),
        thisMonth: total(
          openRows.filter((row) => yearMonthOf(row.dueDate) === month).map((row) => row.amount),
        ),
        lastDue:
          openRows
            .map((row) => row.dueDate)
            .sort()
            .at(-1) ?? null,
      },
    };
  });
}

/** Plano do topo da tela de dívidas. Null se o cálculo falhou: a tela diz isso e segue. */
export async function loadDebtPlan(ctx: TenantContext): Promise<DebtPlanView | null> {
  try {
    return await withHousehold(ctx, async (tx) =>
      currentDebtPlan(tx, await todayOf(tx, ctx.householdId)),
    );
  } catch (error) {
    reportActionFailure("debt_plan_failed", error);
    return null;
  }
}

/** Arquivos das dívidas, sem o conteúdo. Vazio até a migração chegar. */
export function loadDebtFiles(ctx: TenantContext) {
  return tolerateSchemaLag(() => withHousehold(ctx, listDebtDocuments), []);
}

/** Parcela de meta em aberto e a meta, travadas para não serem confirmadas duas vezes. */
export async function openGoalContribution(tx: TenantTx, goalId: string, month: YearMonth) {
  const [contribution] = await tx
    .select()
    .from(goalContributions)
    .where(
      and(
        eq(goalContributions.goalId, goalId),
        eq(goalContributions.month, month),
        isNull(goalContributions.transactionId),
      ),
    )
    .for("update");
  if (!contribution) return null;
  const [goal] = await tx.select().from(goals).where(eq(goals.id, goalId)).for("update");
  if (!goal) return null;
  const months = await tx
    .select({ month: goalContributions.month })
    .from(goalContributions)
    .where(eq(goalContributions.goalId, goalId))
    .orderBy(asc(goalContributions.month));
  const number = months.findIndex((row) => row.month === month) + 1;
  return { contribution, goal, number, total: months.length };
}

/** Parcela em aberto, travada para não ser paga duas vezes. */
export async function openInstallment(tx: TenantTx, id: string) {
  const [installment] = await tx
    .select()
    .from(debtInstallments)
    .where(and(eq(debtInstallments.id, id), isNull(debtInstallments.transactionId)))
    .for("update");
  if (!installment) return null;
  const [debt] = await tx.select().from(debts).where(eq(debts.id, installment.debtId));
  if (!debt) return null;
  const siblings = await tx
    .select({ id: debtInstallments.id })
    .from(debtInstallments)
    .where(eq(debtInstallments.debtId, debt.id));
  return { installment, debt, total: siblings.length };
}
