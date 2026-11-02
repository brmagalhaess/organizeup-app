// Compromissos do mês (faturas, parcelas, metas e rendas em aberto), usados pelas telas da web e
// pelo assistente: as duas leituras precisam dar o mesmo número. Rode dentro de withHousehold.
import {
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
  incomeReceipts,
  householdCurrency,
  incomeSources,
  incomeVacationReceipts,
  incomeYearPlans,
  inArray,
  isSchemaLag,
  lte,
  sql,
  transactions,
  type TenantTx,
} from "@organizeup/db";
import {
  CARD_CATEGORY,
  CONTRIBUTION_CATEGORY,
  DEBT_CATEGORY,
  GOAL_CATEGORY,
  incomeBetween,
  linesTotal,
  monthBounds,
  occurrenceDate,
  openIncomeEntries,
  parseVacationPeriods,
  plainIncomes,
  purchaseLines,
  statementDueDate,
  type IncomeYearPlan,
  type ScheduledEntry,
  type YearMonth,
} from "@organizeup/domain";
import { loadFiscalTables } from "./inputs";

/** Lê uma tabela da 0040. Antes de ela chegar, um erro de SQL não pode abortar a transação da tela. */
async function afterMigration<T>(
  tx: TenantTx,
  read: (step: TenantTx) => Promise<T[]>,
): Promise<T[]> {
  return tx
    .transaction((step) => read(step as TenantTx))
    .catch((error: unknown) => {
      if (isSchemaLag(error)) return [];
      throw error;
    });
}

/** Escolhas de 13º e férias por renda. Sem a tabela ainda, vale o padrão de sempre. */
export async function incomePlansBySource(tx: TenantTx): Promise<Map<string, IncomeYearPlan[]>> {
  const rows = await afterMigration(tx, (step) => step.select().from(incomeYearPlans));
  const bySource = new Map<string, IncomeYearPlan[]>();
  for (const row of rows) {
    const plan: IncomeYearPlan = {
      year: row.year,
      thirteenthMode: row.thirteenthMode,
      firstMonth: row.thirteenthFirstMonth,
      secondMonth: row.thirteenthSecondMonth,
      withVacation: row.thirteenthWithVacation,
      firstReceived: row.thirteenthFirstReceived,
      firstAmount: row.thirteenthFirstAmount,
      singleReceived: row.thirteenthSingleReceived,
      jobStartedOn: row.jobStartedOn,
      soldDays: row.vacationSoldDays,
      periods: parseVacationPeriods(row.vacationPeriods),
    };
    bySource.set(row.incomeSourceId, [...(bySource.get(row.incomeSourceId) ?? []), plan]);
  }
  return bySource;
}

/** Valor lançado da 1ª parcela, por renda e ano: é ele que a 2ª desconta. */
async function firstPaidBySource(tx: TenantTx) {
  const rows = await tx
    .select({
      incomeSourceId: incomeReceipts.incomeSourceId,
      month: incomeReceipts.month,
      amount: transactions.amount,
    })
    .from(incomeReceipts)
    .innerJoin(transactions, eq(incomeReceipts.transactionId, transactions.id))
    .where(eq(incomeReceipts.part, "13-1"));
  const bySource = new Map<string, Record<number, string>>();
  for (const row of rows) {
    const years = bySource.get(row.incomeSourceId) ?? {};
    years[Number(row.month.slice(0, 4))] = row.amount;
    bySource.set(row.incomeSourceId, years);
  }
  return bySource;
}

/** Rendas prontas para o cálculo: toda leitura de previsão passa por aqui, e por isso todas batem. */
export async function withIncomePlans<T extends { id: string }>(tx: TenantTx, sources: T[]) {
  if (sources.length === 0) return [];
  const plans = await incomePlansBySource(tx);
  const paid = await firstPaidBySource(tx);
  return sources.map((source) => ({
    ...source,
    plans: plans.get(source.id) ?? [],
    firstPaid: paid.get(source.id) ?? {},
  }));
}

/** Tudo o que já foi recebido com lançamento, das duas tabelas de baixa. */
export async function incomeReceiptRows(tx: TenantTx) {
  const select = {
    incomeSourceId: incomeReceipts.incomeSourceId,
    month: incomeReceipts.month,
    part: incomeReceipts.part,
  };
  const extra = await afterMigration(tx, (step) =>
    step
      .select({
        incomeSourceId: incomeVacationReceipts.incomeSourceId,
        month: incomeVacationReceipts.month,
        part: incomeVacationReceipts.part,
      })
      .from(incomeVacationReceipts),
  );
  return [...(await tx.select(select).from(incomeReceipts)), ...extra];
}

/** Previsões de renda dos meses pedidos, sem as que já foram recebidas. */
export async function scheduledIncome(
  tx: TenantTx,
  from: YearMonth,
  to: YearMonth,
): Promise<ScheduledEntry[]> {
  const sources = await withIncomePlans(
    tx,
    plainIncomes(await tx.select().from(incomeSources), await householdCurrency(tx)),
  );
  if (sources.length === 0) return [];
  const tables = await loadFiscalTables(tx);
  const entries = incomeBetween(sources, tables, from, to);
  return openIncomeEntries(entries, await incomeReceiptRows(tx), sources);
}

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

/**
 * Cartões com as parcelas calculadas e os meses de fatura já pagos. Com `months`, só as compras com
 * alguma parcela naquelas faturas: a compra cai até dois meses depois da data, e cada parcela no mês
 * seguinte, então uma compra de fora do intervalo não tem linha nele.
 */
export async function cardBook(tx: TenantTx, months?: { from: YearMonth; to: YearMonth }) {
  const cards = await tx.select().from(creditCards).orderBy(asc(creditCards.createdAt));
  const purchases = await tx
    .select()
    .from(cardPurchases)
    .where(
      months
        ? and(
            lte(cardPurchases.purchasedOn, monthBounds(months.to).last),
            sql`${cardPurchases.purchasedOn} + make_interval(months => ${cardPurchases.installments} + 2) >= ${monthBounds(months.from).first}::date`,
          )
        : undefined,
    )
    .orderBy(asc(cardPurchases.purchasedOn));
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
 * definido, por isso é calculada só para os meses pedidos. Com `onlyWindow`, as compras de cartão também
 * ficam só nesses meses: serve a quem não olha nada fora deles.
 */
export async function loadCommitments(
  tx: TenantTx,
  months: { from: YearMonth; to: YearMonth; onlyWindow?: boolean },
) {
  const book = await cardBook(tx, months.onlyWindow ? months : undefined);
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
    book,
  };
}
