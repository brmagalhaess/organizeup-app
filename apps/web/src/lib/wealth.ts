import "server-only";
import { loadSavingsRule } from "@organizeup/agents";
import {
  and,
  asc,
  assets,
  canWrite,
  cashflowPlans,
  categories,
  debts,
  desc,
  earmarks,
  emergencyFund,
  eq,
  gte,
  householdTimezone,
  lte,
  netWorthInputs,
  netWorthSnapshots,
  recordNetWorth,
  transactions,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import {
  addMonths,
  buildMonthEntries,
  DEFAULT_RESERVE_MONTHS,
  entryFlow,
  essentialBaseline,
  essentialSpending,
  money,
  monthBounds,
  recentMonths,
  reserveStatus,
  summarizeNetWorth,
  toDbAmount,
  todayIn,
  yearMonthOf,
} from "@organizeup/domain";
import { loadCommitments } from "./commitments";

/** Dados da reserva de emergência. */
export async function loadReserve(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const month = yearMonthOf(today);
    const closed = recentMonths(addMonths(month, -1), 3);

    const [fund] = await tx.select().from(emergencyFund);
    const marks = await tx
      .select({ accountId: earmarks.accountId })
      .from(earmarks)
      .where(eq(earmarks.purpose, "reserva"));
    const marked = new Set(marks.map((mark) => mark.accountId));
    const input = await netWorthInputs(tx);
    const active = input.accounts.filter((account) => !account.archived);

    const essentials = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.essential, true));
    const essential = new Set(essentials.map((category) => category.id));
    const planRows = await tx.select().from(cashflowPlans);
    const rows = await tx
      .select()
      .from(transactions)
      .where(
        and(
          gte(transactions.occurredOn, monthBounds(closed[0]!).first),
          lte(transactions.occurredOn, monthBounds(month).last),
        ),
      );
    const { scheduled, cardLines } = await loadCommitments(tx, { from: month, to: month });
    const rule = await loadSavingsRule(tx);
    const sum = (values: string[]) =>
      toDbAmount(values.reduce((acc, value) => acc.plus(value), money(0)));
    const linesOf = (ym: string) => cardLines.filter((line) => line.statementMonth === ym);

    const closedTotals = closed.map((ym) =>
      essentialSpending(
        rows.filter((t) => yearMonthOf(t.occurredOn) === ym && t.status === "realizado"),
        linesOf(ym),
        essential,
        rule,
      ),
    );
    const currentEntries = buildMonthEntries(
      month,
      planRows,
      rows.filter((t) => yearMonthOf(t.occurredOn) === month),
      scheduled,
    );
    const currentTotal = essentialSpending(currentEntries, linesOf(month), essential, rule);

    const baseline = essentialBaseline(closedTotals, currentTotal, fund?.monthlyAmount ?? null);
    const targetMonths = fund?.targetMonths ?? DEFAULT_RESERVE_MONTHS;
    const selected = active.filter((account) => marked.has(account.id));
    return {
      month,
      /** Já há gasto lançado? Sem gasto essencial, isso decide para qual tela levar a família. */
      hasExpenses:
        rows.some((t) => entryFlow(t, rule) === "despesa") ||
        planRows.some((plan) => entryFlow(plan, rule) === "despesa") ||
        cardLines.length > 0,
      targetMonths,
      informedMonthly: fund?.monthlyAmount ?? null,
      contribution: fund?.contribution ?? null,
      baseline,
      fx: input.fx,
      accounts: active.map((account) => ({ ...account, selected: marked.has(account.id) })),
      status: reserveStatus(sum(selected.map((a) => a.balance)), baseline.monthly, targetMonths),
    };
  });
}

/** Patrimônio líquido. Com `record`, atualiza a foto do mês. */
export async function loadNetWorth(ctx: TenantContext, options: { record: boolean }) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const input = await netWorthInputs(tx);
    const summary = summarizeNetWorth(input);
    if (
      options.record &&
      canWrite(ctx) &&
      !(money(summary.owned).isZero() && money(summary.owed).isZero())
    )
      await recordNetWorth(tx, ctx.householdId, yearMonthOf(today), summary);

    const assetRows = await tx.select().from(assets).orderBy(asc(assets.createdAt));
    const debtNames = await tx
      .select({ id: debts.id, name: debts.name, archived: debts.archived })
      .from(debts);
    const snapshots = await tx
      .select({
        month: netWorthSnapshots.month,
        owned: netWorthSnapshots.owned,
        owed: netWorthSnapshots.owed,
        net: netWorthSnapshots.net,
      })
      .from(netWorthSnapshots)
      .orderBy(desc(netWorthSnapshots.month))
      .limit(12);

    const balanceOf = new Map(input.debts.map((debt) => [debt.id, debt.balance]));
    return {
      today,
      summary,
      fx: input.fx,
      accounts: input.accounts.filter((account) => !account.archived),
      debts: input.debts.filter((debt) => !debt.archived && money(debt.balance).gt(0)),
      debtOptions: debtNames.filter((debt) => !debt.archived),
      assets: assetRows.map((asset) => {
        const owed = asset.linkedDebtId ? (balanceOf.get(asset.linkedDebtId) ?? "0") : null;
        return {
          id: asset.id,
          name: asset.name,
          kind: asset.kind,
          value: asset.value,
          valuedOn: asset.valuedOn,
          linkedDebtId: asset.linkedDebtId,
          equity: owed === null ? null : toDbAmount(money(asset.value).minus(owed)),
        };
      }),
      history: snapshots.reverse(),
    };
  });
}
