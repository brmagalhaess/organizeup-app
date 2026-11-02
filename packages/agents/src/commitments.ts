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
  inArray,
  lte,
  sql,
  type TenantTx,
} from "@organizeup/db";
import {
  CARD_CATEGORY,
  CONTRIBUTION_CATEGORY,
  DEBT_CATEGORY,
  GOAL_CATEGORY,
  incomeBetween,
  incomeKey,
  linesTotal,
  monthBounds,
  occurrenceDate,
  plainIncomes,
  purchaseLines,
  statementDueDate,
  type IncomePart,
  type ScheduledEntry,
  type YearMonth,
} from "@organizeup/domain";
import { loadFiscalTables } from "./inputs";

/** Previsões de renda dos meses pedidos, sem as que já foram recebidas. */
export async function scheduledIncome(
  tx: TenantTx,
  from: YearMonth,
  to: YearMonth,
): Promise<ScheduledEntry[]> {
  const sources = plainIncomes(await tx.select().from(incomeSources), await householdCurrency(tx));
  if (sources.length === 0) return [];
  const tables = await loadFiscalTables(tx);
  const receipts = await tx.select().from(incomeReceipts);
  const received = new Set(
    receipts.map((r) => incomeKey(r.incomeSourceId, r.month, r.part as IncomePart)),
  );
  return incomeBetween(sources, tables, from, to).filter((entry) => !received.has(entry.key));
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
