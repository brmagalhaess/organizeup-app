import "server-only";
import { incomeReceiptRows, loadFiscalTables, withIncomePlans } from "@organizeup/agents";
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
  incomeSources,
  incomeYearPlans,
  isNull,
  isSchemaLag,
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
  findIncomeEntry,
  fiscalTableFor,
  incomeYearView,
  isPayroll,
  money,
  monthlyNet,
  plainIncomes,
  receivedInYear,
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
  const [source] = await withIncomePlans(
    tx,
    plainIncomes(
      await tx.select().from(incomeSources).where(eq(incomeSources.id, sourceId)),
      await householdCurrency(tx),
    ),
  );
  if (!source) return null;
  const tables = await loadFiscalTables(tx);
  // O 13º já recebido pode ser de antes de a renda entrar aqui: a previsão começa depois, ele não.
  const reachable =
    (part === "13-1" || part === "13-2") && month < source.startMonth
      ? { ...source, startMonth: month }
      : source;
  const entry = findIncomeEntry(reachable, tables, month, part);
  return entry ? { source, entry, part: part as IncomePart } : null;
}

/** A tabela das escolhas já chegou? Antes da 0040, salvar uma escolha pede para tentar depois. */
export async function incomePlanStoreReady(tx: TenantTx): Promise<boolean> {
  return tx
    .transaction((step) => step.select({ id: incomeYearPlans.id }).from(incomeYearPlans).limit(1))
    .then(
      () => true,
      (error: unknown) => {
        if (isSchemaLag(error)) return false;
        throw error;
      },
    );
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
    const sources = await withIncomePlans(
      tx,
      plainIncomes(
        await tx
          .select()
          .from(incomeSources)
          .where(or(isNull(incomeSources.endMonth), gte(incomeSources.endMonth, month)))
          .orderBy(asc(incomeSources.createdAt)),
        await householdCurrency(tx),
      ),
    );
    const receipts = await incomeReceiptRows(tx);
    const withReceipts = new Set(receipts.map((r) => r.incomeSourceId));
    const year = Number(month.slice(0, 4));

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
        yearView: incomeYearView(source, tables, year),
        // O ano seguinte aparece no cartão com a escolha dele ou a herdada; sem escolha, não aparece.
        nextYearView: source.plans.some((plan) => plan.year <= year + 1)
          ? incomeYearView(source, tables, year + 1)
          : null,
        receivedParts: receivedInYear(receipts, source, year),
        receivedNext: receivedInYear(receipts, source, year + 1),
      };
    });
    const sum = (values: string[]) =>
      toDbAmount(values.reduce((acc, value) => acc.plus(value), money(0)));

    return {
      today,
      month,
      year,
      table,
      tables,
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
        thirteenth: sum(views.map((v) => v.yearView?.thirteenth?.net ?? "0")),
      },
    };
  });
}
