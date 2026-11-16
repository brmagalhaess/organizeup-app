import "server-only";
import { loadSavingsRule } from "@organizeup/agents";
import {
  accountBalances,
  accounts,
  accountsWithMovement,
  accountTransfers,
  and,
  asc,
  cashflowPlans,
  categories,
  desc,
  eq,
  firstMovementDate,
  gte,
  householdNotifications,
  householdSettings,
  householdTimezone,
  incomeSources,
  lte,
  or,
  people,
  sql,
  transactions,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import {
  activityByAccount,
  addMonths,
  buildMonthEntries,
  cardsInMonth,
  contributionLines,
  DASHBOARD_SERIES_MONTHS,
  entryFlow,
  expenseLines,
  incomeLines,
  isForeign,
  isYearMonth,
  money,
  monthBounds,
  monthsBetween,
  pendingEntries,
  plannedNetByAccount,
  planPoint,
  projectBalances,
  recentMonths,
  resolvePeriod,
  splitCardSavings,
  SAVINGS_NOTICE_KEY,
  summarizeMonth,
  toDbAmount,
  todayIn,
  yearMonthOf,
  type EntryFlow,
  type MonthEntry,
} from "@organizeup/domain";
import { transferKnown } from "./bank-transfers";
import { loadCommitments } from "./commitments";
import { onboardingStatus } from "./onboarding";
import { loadOwners, peopleOfMonth } from "./owners";

/** Carrega o necessário para a tela de lançamentos. Transação curta, sem chamadas externas. */
export async function loadMonth(ctx: TenantContext, requestedMonth?: string | null) {
  return withHousehold(ctx, async (tx) => {
    const [settings] = await tx
      .select({ timezone: householdSettings.timezone })
      .from(householdSettings)
      .where(eq(householdSettings.householdId, ctx.householdId));
    const today = todayIn(settings?.timezone);
    const month =
      requestedMonth && isYearMonth(requestedMonth) ? requestedMonth : yearMonthOf(today);
    const { first, last } = monthBounds(month);

    const accountRows = await tx.select().from(accounts).orderBy(asc(accounts.createdAt));
    const categoryRows = await tx
      .select()
      .from(categories)
      .orderBy(asc(categories.position), asc(categories.name));
    const planRows = await tx.select().from(cashflowPlans);
    const transactionRows = await tx
      .select()
      .from(transactions)
      .where(and(gte(transactions.occurredOn, first), lte(transactions.occurredOn, last)));

    const { scheduled, cardLines, cardCategoryId } = await loadCommitments(tx, {
      from: month,
      to: month,
      onlyWindow: true,
    });
    const entries = buildMonthEntries(month, planRows, transactionRows, scheduled);
    const lines = cardLines.filter((line) => line.statementMonth === month);
    const rule = await loadSavingsRule(tx);
    const split = splitCardSavings(entries, lines, cardCategoryId, rule);
    return {
      month,
      today,
      accounts: accountRows,
      categories: categoryRows,
      entries,
      /** De quem é cada entrada e quanto cada pessoa gastou no mês. */
      people: peopleOfMonth(await loadOwners(tx), entries, split, rule),
      /** O fluxo de cada entrada: a lista mostra o aporte, com o nome dele. */
      flows: Object.fromEntries(
        entries.map((entry): [string, EntryFlow] => [entry.key, entryFlow(entry, rule)]),
      ),
      summary: summarizeMonth(split, rule),
      /** Compras na fatura do mês, para a tela abrir o cartão ao filtrar por categoria. */
      cardLines: lines,
      /** Categorias de dinheiro guardado: o filtro Aportes abre as compras delas no cartão. */
      savingCategoryIds: [...rule.investmentCategories, ...rule.goalCategories],
    };
  });
}

/** Últimas transferências, da mais nova à mais antiga. */
export async function loadTransfers(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const known = new Map(
      (
        await tx
          .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
          .from(accounts)
      ).map((row) => [row.id, row]),
    );
    const rows = await tx
      .select()
      .from(accountTransfers)
      .orderBy(desc(accountTransfers.occurredOn), desc(accountTransfers.createdAt))
      .limit(20);
    // As que vieram do banco: desfazer devolve os dois lançamentos (ADR-0042).
    const fromBank = new Set(
      (await transferKnown(tx)).filter((entry) => entry.fingerprint).map((entry) => entry.key),
    );
    return {
      today: todayIn(await householdTimezone(tx, ctx.householdId)),
      /** Conta com movimento não muda de moeda. */
      moved: [...(await accountsWithMovement(tx))],
      rows: rows.map((row) => {
        const from = known.get(row.fromAccountId);
        const to = known.get(row.toAccountId);
        return {
          id: row.id,
          fromName: from?.name ?? "Conta",
          toName: to?.name ?? "Conta",
          fromCurrency: from?.currency ?? ("BRL" as const),
          toCurrency: to?.currency ?? ("BRL" as const),
          amount: row.amount,
          toAmount: row.toAmount,
          occurredOn: row.occurredOn,
          note: row.note,
          fromBank: fromBank.has(`x:${row.id}`),
        };
      }),
    };
  });
}

/**
 * Saldo atual de cada conta (`accountBalances`): `nativeBalance` na moeda dela e `balance` na moeda principal.
 */
export async function loadAccountBalances(ctx: TenantContext) {
  return withHousehold(ctx, (tx) => accountBalances(tx));
}

/**
 * Dados do painel para o mês pedido (docs/specs/painel.md). Lê só o período: os 12 meses até o escolhido e
 * os meses em volta de hoje, de onde saem os próximos vencimentos e a projeção do saldo.
 */
export async function loadOverview(ctx: TenantContext, requestedMonth?: unknown) {
  return withHousehold(ctx, async (tx) => {
    const [settings] = await tx
      .select({
        timezone: householdSettings.timezone,
        city: householdSettings.city,
        state: householdSettings.state,
      })
      .from(householdSettings)
      .where(eq(householdSettings.householdId, ctx.householdId));
    const today = todayIn(settings?.timezone);
    const firstMovement = await firstMovementDate(tx);
    const period = resolvePeriod(requestedMonth, today, firstMovement);
    const { month, current, phase } = period;
    const months = recentMonths(month, DASHBOARD_SERIES_MONTHS);
    const nearFrom = addMonths(current, -1);
    const nearTo = month > addMonths(current, 1) ? month : addMonths(current, 1);

    const categoryRows = await tx.select().from(categories);
    const planRows = await tx.select().from(cashflowPlans);
    const [sourceCount] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(incomeSources);
    const [peopleCount] = await tx.select({ total: sql<number>`count(*)::int` }).from(people);
    const [incomeCount] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(transactions)
      .where(eq(transactions.kind, "receita"));
    const transactionRows = await tx
      .select()
      .from(transactions)
      .where(
        or(
          and(
            gte(transactions.occurredOn, `${months[0]!}-01`),
            lte(transactions.occurredOn, monthBounds(month).last),
          ),
          and(
            gte(transactions.occurredOn, `${nearFrom}-01`),
            lte(transactions.occurredOn, monthBounds(nearTo).last),
          ),
        ),
      );

    const { scheduled, cardLines, cardCategoryId, book } = await loadCommitments(tx, {
      from: months[0]! < nearFrom ? months[0]! : nearFrom,
      to: nearTo,
      onlyWindow: true,
    });
    const known = new Map<string, MonthEntry[]>();
    const inMonth = (ym: string) => {
      const entries =
        known.get(ym) ??
        buildMonthEntries(
          ym,
          planRows,
          transactionRows.filter((t) => yearMonthOf(t.occurredOn) === ym),
          scheduled,
        );
      known.set(ym, entries);
      return entries;
    };
    const rule = await loadSavingsRule(tx);
    const linesOf = (ym: string) => cardLines.filter((line) => line.statementMonth === ym);
    const lines = linesOf(month);
    // Para somar, a compra de aporte no cartão sai da fatura (ADR-0027). A lista segue com `inMonth`.
    const flowsOf = (ym: string) =>
      splitCardSavings(inMonth(ym), linesOf(ym), cardCategoryId, rule);
    const flows = flowsOf(month);
    const summaryOf = (ym: string) => summarizeMonth(flowsOf(ym), rule);

    // Saldo: o de hoje, igual ao da tela de Contas, e, em mês passado, o do último dia com a cotação dele.
    const now = await accountBalances(tx);
    const shown =
      phase === "passado" ? await accountBalances(tx, { on: monthBounds(month).last }) : now;
    const ahead = phase === "passado" ? 0 : monthsBetween(current, month) + 1;
    const projection = projectBalances(
      shown.accounts,
      plannedNetByAccount(
        Array.from({ length: ahead }, (_, index) =>
          activityByAccount(inMonth(addMonths(current, index)), rule),
        ),
      ),
    );
    const activity = activityByAccount(flows, rule);
    const idle = summarizeMonth([], rule);
    const [noticeSeen] = await tx
      .select({ id: householdNotifications.id })
      .from(householdNotifications)
      .where(eq(householdNotifications.dedupeKey, SAVINGS_NOTICE_KEY));

    const onboarding = await onboardingStatus(tx);
    const balances = now.accounts;
    return {
      period,
      today,
      place: settings?.city
        ? `${settings.city}${settings.state ? `/${settings.state}` : ""}`
        : null,
      /** Nada lançado, previsto nem cadastrado que mexa no mês: tela de boas-vindas. */
      fresh: firstMovement === null && planRows.length === 0 && scheduled.length === 0,
      balance: {
        value:
          phase === "futuro"
            ? projection.total
            : toDbAmount(
                shown.accounts
                  .filter((b) => !b.archived)
                  .reduce((acc, b) => acc.plus(b.balance), money(0)),
              ),
        projected: projection.total,
        asOf: monthBounds(month).last,
        fx: shown.fx,
      },
      summary: summaryOf(month),
      previousSummary: summaryOf(addMonths(month, -1)),
      /** Tudo do mês escolhido, lançado ou previsto, do mais recente ao mais antigo: a lista do painel. */
      entries: [...inMonth(month)].sort((a, b) => b.date.localeCompare(a.date)),
      /** De quem é cada entrada e quanto cada pessoa gastou no mês. */
      people: peopleOfMonth(await loadOwners(tx), inMonth(month), flows, rule),
      series: months.map((ym) => planPoint(ym, summaryOf(ym))),
      expenses: expenseLines(flows, lines, cardCategoryId, rule),
      incomes: incomeLines(flows, rule),
      contributions: contributionLines(flows, rule),
      /** A nota que explica a mudança: uma vez, para quem tem aporte ou resgate lançado (ADR-0027). */
      savingsNotice:
        !noticeSeen &&
        transactionRows.some((row) => {
          const flow = entryFlow(row, rule);
          return flow === "aporte" || flow === "resgate";
        }),
      accounts: projection.rows
        .filter((account) => !account.archived || activity.has(account.id))
        .map((account) => {
          const { received, spent, plannedIncome, plannedExpense } =
            activity.get(account.id) ?? idle;
          const { contributed, plannedContribution } = activity.get(account.id) ?? idle;
          const foreign = isForeign(account.currency, shown.main);
          return {
            ...account,
            received,
            spent,
            plannedIncome,
            plannedExpense,
            contributed,
            plannedContribution,
            foreign,
          };
        }),
      cards: cardsInMonth(book, month, today),
      categoryNames: new Map(categoryRows.map((c) => [c.id, c.name])),
      pending: pendingEntries(
        [
          ...inMonth(addMonths(current, -1)),
          ...inMonth(current),
          ...inMonth(addMonths(current, 1)),
        ],
        today,
        4,
      ),
      checklist: {
        onboarding: !onboarding.pending,
        income:
          (incomeCount?.total ?? 0) > 0 ||
          (sourceCount?.total ?? 0) > 0 ||
          planRows.some((p) => p.kind === "receita"),
        recurring: planRows.some((p) => p.kind === "despesa"),
        balance: balances.some((b) => !money(b.openingBalance).isZero()),
        family: (peopleCount?.total ?? 0) > 1,
      },
    };
  });
}
