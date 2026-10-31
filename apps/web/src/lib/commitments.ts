import "server-only";
import {
  accounts,
  and,
  asc,
  cardPurchases,
  cardStatementPayments,
  categories,
  creditCards,
  debtInstallments,
  debts,
  eq,
  goalContributions,
  goals,
  householdSettings,
  inArray,
  isNull,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  CARD_CATEGORY,
  CONTRIBUTION_CATEGORY,
  DEBT_CATEGORY,
  GOAL_CATEGORY,
  linesTotal,
  money,
  occurrenceDate,
  purchaseLines,
  statementDueDate,
  statementMonthOf,
  toDbAmount,
  todayIn,
  yearMonthOf,
  type ScheduledEntry,
  type StatementLine,
  type YearMonth,
} from "@organizeup/domain";
import { scheduledIncome } from "./income-data";

/** Id das categorias do sistema, garantidas por `ensureFinanceDefaults`. */
export async function systemCategories(tx: TenantTx) {
  const rows = await tx
    .select({ id: categories.id, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(
      inArray(categories.name, [
        CARD_CATEGORY,
        DEBT_CATEGORY,
        GOAL_CATEGORY,
        CONTRIBUTION_CATEGORY,
      ]),
    );
  // "Metas e objetivos" existe como despesa e como receita.
  const find = (kind: "despesa" | "receita", name: string) =>
    rows.find((row) => row.kind === kind && row.name === name)?.id;
  return {
    card: find("despesa", CARD_CATEGORY),
    debt: find("despesa", DEBT_CATEGORY),
    goal: find("despesa", GOAL_CATEGORY),
    goalIncome: find("receita", GOAL_CATEGORY),
    contribution: find("despesa", CONTRIBUTION_CATEGORY),
  };
}

export const goalEntryDescription = (name: string, number: number, total: number) =>
  `Meta: ${name} (${number}/${total})`;

/** Parcelas de meta ainda não confirmadas. Meta sem conta de origem fica fora: não há de onde sair. */
async function goalEntries(tx: TenantTx, categoryId: string | undefined) {
  const rows = await tx
    .select({ contribution: goalContributions, goal: goals })
    .from(goalContributions)
    .innerJoin(goals, eq(goalContributions.goalId, goals.id))
    .orderBy(asc(goalContributions.month));
  const position = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const { contribution } of rows) {
    const number = (totals.get(contribution.goalId) ?? 0) + 1;
    totals.set(contribution.goalId, number);
    position.set(contribution.id, number);
  }
  return rows.flatMap(({ contribution, goal }): ScheduledEntry[] => {
    const active = goal.status !== "pausada" && goal.status !== "concluida";
    if (contribution.transactionId !== null || !goal.accountId || !active) return [];
    return [
      {
        key: `g:${goal.id}:${contribution.month}`,
        source: "meta",
        id: goal.id,
        kind: "despesa",
        description: goalEntryDescription(
          goal.name,
          position.get(contribution.id)!,
          totals.get(goal.id)!,
        ),
        amount: contribution.amount,
        date: occurrenceDate(goal.planDay, contribution.month),
        categoryId: categoryId ?? "",
        accountId: goal.accountId,
      },
    ];
  });
}

/** Cartões com as parcelas calculadas e os meses de fatura já pagos. */
async function cardBook(tx: TenantTx) {
  const cards = await tx.select().from(creditCards).orderBy(asc(creditCards.createdAt));
  const purchases = await tx.select().from(cardPurchases).orderBy(asc(cardPurchases.purchasedOn));
  const payments = await tx.select().from(cardStatementPayments);
  return cards.map((card) => ({
    card,
    lines: purchases
      .filter((purchase) => purchase.cardId === card.id)
      .flatMap((purchase) => purchaseLines(purchase, card)),
    paid: new Set(payments.filter((p) => p.cardId === card.id).map((p) => p.statementMonth)),
  }));
}

/**
 * Faturas, parcelas, metas e rendas em aberto, prontas para entrar no fluxo do mês. A renda não tem fim
 * definido, por isso é calculada só para os meses pedidos.
 */
export async function loadCommitments(tx: TenantTx, months: { from: YearMonth; to: YearMonth }) {
  const book = await cardBook(tx);
  const category = await systemCategories(tx);

  const statements: ScheduledEntry[] = book.flatMap(({ card, lines, paid }) => {
    const open = [...new Set(lines.map((line) => line.statementMonth))].filter(
      (month) => !paid.has(month),
    );
    return open.map((month) => ({
      key: `f:${card.id}:${month}`,
      source: "fatura",
      id: card.id,
      description: `Fatura ${card.name}`,
      amount: linesTotal(lines.filter((line) => line.statementMonth === month)),
      date: statementDueDate(month, card),
      categoryId: category.card ?? "",
      accountId: card.payingAccountId,
    }));
  });

  const rows = await tx
    .select({ installment: debtInstallments, debt: debts })
    .from(debtInstallments)
    .innerJoin(debts, eq(debtInstallments.debtId, debts.id))
    .where(eq(debts.archived, false));
  const totals = new Map<string, number>();
  for (const { installment } of rows)
    totals.set(installment.debtId, (totals.get(installment.debtId) ?? 0) + 1);

  const installments: ScheduledEntry[] = rows
    .filter(({ installment }) => installment.transactionId === null)
    .map(({ installment, debt }) => ({
      key: `d:${installment.id}`,
      source: "parcela",
      id: installment.id,
      description: `${debt.name} (${installment.number}/${totals.get(debt.id)})`,
      amount: installment.amount,
      date: installment.dueDate,
      categoryId: category.debt ?? "",
      accountId: debt.accountId,
    }));

  return {
    scheduled: [
      ...statements,
      ...installments,
      ...(await goalEntries(tx, category.goal)),
      ...(await scheduledIncome(tx, months.from, months.to)),
    ],
    cardLines: book.flatMap(({ lines }) => lines),
    cardCategoryId: category.card,
  };
}

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
