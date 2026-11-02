import "server-only";
import { loadFiscalTables } from "@organizeup/agents";
import {
  accounts,
  and,
  asc,
  cashflowPlans,
  categories,
  eq,
  gte,
  householdCurrency,
  householdTimezone,
  incomeReceipts,
  incomeSources,
  isNull,
  or,
  people,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  calculatePayslip,
  calculateThirteenth,
  calculateVacation,
  CARD_CATEGORY,
  DEBT_CATEGORY,
  fiscalTableFor,
  isPayroll,
  money,
  monthIncome,
  monthlyNet,
  plainIncomes,
  toDbAmount,
  todayIn,
  yearMonthOf,
  type IncomePart,
  type IncomeSourceInput,
  type YearMonth,
} from "@organizeup/domain";

export { loadFiscalTables };

/** Uma previsão específica, para dar baixa nela. */
export async function incomeOccurrence(
  tx: TenantTx,
  sourceId: string,
  month: YearMonth,
  part: string,
) {
  const [source] = plainIncomes(
    await tx.select().from(incomeSources).where(eq(incomeSources.id, sourceId)),
    await householdCurrency(tx),
  );
  if (!source) return null;
  const tables = await loadFiscalTables(tx);
  const key = `r:${sourceId}:${month}:${part}`;
  const entry = monthIncome(source, tables, month).find((item) => item.key === key);
  return entry ? { source, entry, part: part as IncomePart } : null;
}

const toPayroll = (source: IncomeSourceInput) => ({
  gross: source.amount,
  dependents: source.dependents,
  pension: source.pensionAmount,
  otherDiscounts: source.otherDiscounts,
});

/** Dados da tela de renda. */
export async function loadIncome(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const month = yearMonthOf(today);
    const tables = await loadFiscalTables(tx);
    const table = fiscalTableFor(tables, month);
    const sources = plainIncomes(
      await tx
        .select()
        .from(incomeSources)
        .where(or(isNull(incomeSources.endMonth), gte(incomeSources.endMonth, month)))
        .orderBy(asc(incomeSources.createdAt)),
      await householdCurrency(tx),
    );
    const receipts = await tx
      .select({ sourceId: incomeReceipts.incomeSourceId })
      .from(incomeReceipts);
    const withReceipts = new Set(receipts.map((r) => r.sourceId));

    const accountRows = await tx
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(eq(accounts.archived, false))
      .orderBy(asc(accounts.createdAt));
    const categoryRows = await tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.kind, "receita"), eq(categories.archived, false)))
      .orderBy(asc(categories.position), asc(categories.name));
    const peopleRows = await tx
      .select({ id: people.id, name: people.name })
      .from(people)
      .orderBy(asc(people.createdAt));
    const plans = await tx
      .select({ id: cashflowPlans.id, endMonth: cashflowPlans.endMonth })
      .from(cashflowPlans)
      .where(eq(cashflowPlans.kind, "receita"));
    const recurringIncome = plans.filter((p) => p.endMonth === null || p.endMonth >= month).length;

    const views = sources.map((source) => {
      const payroll = isPayroll(source);
      return {
        ...source,
        hasReceipts: withReceipts.has(source.id),
        monthly: monthlyNet(source, tables, month),
        payslip: payroll ? calculatePayslip(toPayroll(source), table) : null,
        thirteenth: payroll ? calculateThirteenth(toPayroll(source), table) : null,
        vacation: payroll ? calculateVacation(toPayroll(source), table) : null,
      };
    });
    const sum = (values: string[]) =>
      toDbAmount(values.reduce((acc, value) => acc.plus(value), money(0)));

    return {
      today,
      month,
      table,
      accounts: accountRows,
      categories: categoryRows.filter((c) => c.name !== CARD_CATEGORY && c.name !== DEBT_CATEGORY),
      people: peopleRows,
      recurringIncome,
      sources: views,
      summary: {
        monthly: sum(views.map((v) => v.monthly)),
        gross: sum(views.map((v) => v.payslip?.gross ?? v.monthly)),
        discounts: sum(
          views.map((v) =>
            v.payslip ? toDbAmount(money(v.payslip.gross).minus(v.payslip.net)) : "0",
          ),
        ),
        thirteenth: sum(views.map((v) => v.thirteenth?.net ?? "0")),
      },
    };
  });
}
