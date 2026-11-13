import {
  AlertCircle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Clock,
  Info,
  Landmark,
  Scale,
  Upload,
} from "lucide-react";
import type { Metadata } from "next";
import { useLocale, useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { getBrazilRules, getMoney } from "@/i18n/money-server";
import Link from "next/link";
import { dismissSavingsNotice } from "./notificacoes/actions";
import { canWrite, readFamilyAccess } from "@organizeup/db";
import {
  comparableTotals,
  foldCategories,
  hasAnything,
  hasMovement,
  money,
  percentChange,
  percentOf,
  toDbAmount,
  yearMonthOf,
  canView,
} from "@organizeup/domain";
import { ConfirmEntryButton } from "@/components/confirm-entry-button";
import { amountClass, buttonClass, confirmAction, cx } from "@/components/styles";
import { PersonDot, PersonSpendingBars, spendingTexts } from "@/components/person";
import { Badge, Button, Card, EmptyState, PageHeader, StatTile } from "@/components/ui";
import { Insights } from "@/components/insights/insights";
import {
  formatDayMonth,
  formatLongDate,
  formatMonthYear,
  formatPercent,
  type MoneyText,
} from "@/i18n/format";
import { loadOverview } from "@/lib/finance-data";
import { loadMonthInvestments } from "@/lib/investments";
import { smartImportOpen } from "@/lib/importador/access";
import { requireTenant } from "@/lib/session";
import { loadTopSuggestions } from "@/lib/suggestions";
import { loadNetWorth, loadReserve } from "@/lib/wealth";
import { systemTextOf } from "@/i18n/system-text";
import { CashflowChart } from "./cashflow-chart";
import { FirstSteps } from "./first-steps";
import { orderEntries } from "./lancamentos/entry-order";
import {
  AccountsSection,
  barRows,
  CategoryBars,
  DividendsSection,
  InvestmentsSection,
  ModuleInvite,
  SectionLinks,
  SmallTile,
} from "./overview-sections";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("metaTitle") };
}

function DueBadge({ overdue }: { overdue: boolean }) {
  const t = useTranslations("dashboard.due");
  return overdue ? (
    <Badge tone="danger">
      <AlertCircle className="size-3" aria-hidden="true" />
      {t("overdue")}
    </Badge>
  ) : (
    <Badge>
      <Clock className="size-3" aria-hidden="true" />
      {t("planned")}
    </Badge>
  );
}

/** Uma linha de explicação logo abaixo do resumo. */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-xs text-muted">
      <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

type Overview = Awaited<ReturnType<typeof loadOverview>>;

function Upcoming({
  data,
  moneyText,
  describe,
  writable,
}: {
  data: Overview;
  moneyText: MoneyText;
  describe: (entry: Overview["pending"][number]) => string;
  writable: boolean;
}) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const elsewhere = data.period.phase !== "atual";
  return (
    <Card
      title={t("upcoming.title")}
      description={elsewhere ? t("upcoming.descriptionToday") : t("upcoming.description")}
      actions={
        <Link
          href="/app/calendario"
          className="text-sm font-medium underline-offset-2 hover:underline"
        >
          {t("upcoming.calendar")}
        </Link>
      }
    >
      {data.pending.length === 0 ? (
        <p className="text-sm text-muted">{t("upcoming.emptyText")}</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-line p-0" aria-label={t("upcoming.title")}>
          {data.pending.map((entry) => (
            <li
              key={`${entry.key}:${entry.date}`}
              className="flex items-center gap-3 py-2.5 max-sm:nth-[n+4]:hidden"
            >
              <span className="w-12 shrink-0 text-sm tabular-nums text-muted">
                {formatDayMonth(entry.date, locale)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{describe(entry)}</p>
                <p
                  className={cx(
                    "whitespace-nowrap text-xs font-medium tabular-nums",
                    amountClass(entry.kind),
                  )}
                >
                  {entry.kind === "receita" ? "+ " : "− "}
                  {moneyText(entry.amount)}
                </p>
                <div className="mt-1 sm:hidden">
                  <DueBadge overdue={entry.overdue} />
                </div>
              </div>
              <div className="hidden sm:block">
                <DueBadge overdue={entry.overdue} />
              </div>
              {writable ? (
                <ConfirmEntryButton
                  entryKey={entry.key}
                  month={yearMonthOf(entry.date)}
                  label={t(`confirm.${confirmAction(entry)}`)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const ENTRIES_SHOWN = 40;

/** Tudo o que entrou, saiu ou está previsto no mês, para conferir sem sair do painel. */
function MonthEntries({
  data,
  label,
  moneyText,
  describe,
}: {
  data: Overview;
  label: string;
  moneyText: MoneyText;
  describe: (entry: Overview["entries"][number]) => string;
}) {
  const t = useTranslations("dashboard.entries");
  const locale = useLocale();
  const total = data.entries.length;
  // A mesma ordem da tela de Lançamentos: hoje no topo, e o que ainda vai vencer depois.
  const { recent, upcoming } = orderEntries(data.entries, data.today);
  const shown = [...recent, ...upcoming].slice(0, ENTRIES_SHOWN);
  const href = `/app/lancamentos?m=${data.period.month}`;
  const personOf = (key: string) =>
    data.people.list.find((person) => person.id === data.people.of[key]);
  return (
    <Card
      title={t("title")}
      description={
        total === 0
          ? t("descriptionEmpty", { month: label })
          : t("description", { month: label, count: total })
      }
      actions={
        <Link href={href} className="text-sm font-medium underline-offset-2 hover:underline">
          {t("viewAll")}
        </Link>
      }
    >
      {total === 0 ? null : (
        <>
          {/* Lista com rolagem própria: cabe ao lado dos gráficos sem empurrar o resto do painel. */}
          <ul
            // Rolável pelo teclado: quem não usa mouse também chega ao fim da lista.
            tabIndex={0}
            className="m-0 max-h-[26rem] list-none divide-y divide-line overflow-y-auto p-0 pr-1 [scrollbar-width:thin]"
            aria-label={t("title")}
          >
            {shown.map((entry) => {
              const overdue = entry.status === "previsto" && entry.date < data.today;
              const person = personOf(entry.key);
              return (
                <li key={entry.key} className="flex items-center gap-3 py-2.5">
                  <span className="w-12 shrink-0 text-sm tabular-nums text-muted">
                    {formatDayMonth(entry.date, locale)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{describe(entry)}</p>
                    <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                      <span className="shrink-0">
                        {entry.status === "realizado"
                          ? t("done")
                          : overdue
                            ? t("overdue")
                            : t("planned")}
                      </span>
                      {person ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <PersonDot name={person.name} slot={person.slot} />
                        </>
                      ) : null}
                    </p>
                  </div>
                  <p
                    className={cx(
                      "whitespace-nowrap text-sm font-medium tabular-nums",
                      amountClass(entry.kind),
                    )}
                  >
                    {entry.kind === "receita" ? "+ " : "− "}
                    {moneyText(entry.amount)}
                  </p>
                </li>
              );
            })}
          </ul>
          {total > shown.length ? (
            <p className="mt-3 text-xs text-muted">
              <Link href={href} className="underline underline-offset-2">
                {t("more", { count: total - shown.length })}
              </Link>
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { session, ctx } = await requireTenant();
  const { mes } = await searchParams;
  const data = await loadOverview(ctx, mes);
  const { month, current, phase, previous } = data.period;
  const [reserve, wealth, suggestions, investing, brazilRules, access] = await Promise.all([
    loadReserve(ctx),
    loadNetWorth(ctx, { record: false }),
    loadTopSuggestions(ctx),
    loadMonthInvestments(ctx, month),
    getBrazilRules(),
    readFamilyAccess(ctx),
  ]);
  const [t, tPeople, tSystem, locale, moneyText] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("porPessoa"),
    getTranslations("sistema"),
    getLocale(),
    getMoney(),
  ]);
  const system = systemTextOf(tSystem);
  const writable = canWrite(ctx);
  const smartImport = writable && (await smartImportOpen(session.user));
  const firstName = session.user.name.split(" ")[0] ?? "";
  const date = formatLongDate(data.today, locale);
  const label = formatMonthYear(month, locale);
  const amount = (value: string) => moneyText(value);
  const future = phase === "futuro";
  const past = phase === "passado";
  const { summary, previousSummary } = data;

  /** Compara com o mês anterior em texto, sem depender de cor. */
  const comparison = (now: string, before: string) => {
    const change = percentChange(now, before);
    if (change === null) return t("comparison.noBase");
    if (change === 0) return t("comparison.same");
    const percent = formatPercent(Math.abs(change), locale);
    return change > 0 ? t("comparison.more", { percent }) : t("comparison.less", { percent });
  };
  const shown = comparableTotals(summary, phase);
  const before = comparableTotals(previousSummary, phase);
  const openText = past ? "stats.openPast" : "stats.open";
  const moneyMoved = [shown.contribution, shown.redemption, summary.plannedContribution].some(
    (value) => !money(value).isZero(),
  );

  // Quanto das receitas do mês as despesas já consumiram, e quanto chegam a consumir com o que está em aberto.
  const incomeTotal = money(summary.received).plus(summary.plannedIncome);
  const spentShare = incomeTotal.lte(0)
    ? null
    : (() => {
        const base = incomeTotal.toFixed(2);
        const done = Math.min(percentOf(summary.spent, base), 100);
        const all = Math.min(
          percentOf(money(summary.spent).plus(summary.plannedExpense).toFixed(2), base),
          100,
        );
        return { done, open: Math.max(all - done, 0), all };
      })();
  const spentText =
    spentShare === null
      ? ""
      : future
        ? t("stats.shareFuture", { percent: formatPercent(spentShare.all, locale) })
        : spentShare.open > 0
          ? t("stats.shareWithOpen", {
              done: formatPercent(spentShare.done, locale),
              all: formatPercent(spentShare.all, locale),
            })
          : t("stats.share", { percent: formatPercent(spentShare.done, locale) });

  const tile = (open: string, base: string, now: string) => (
    <>
      {phase === "atual" && !hasMovement(summary) ? null : (
        <span className="block">{comparison(now, base)}</span>
      )}
      {!future && !money(open).isZero() ? (
        <span className="block">{t(openText, { amount: amount(open) })}</span>
      ) : null}
    </>
  );

  const nameOf = (id: string) =>
    system.name(data.categoryNames.get(id) ?? t("spending.uncategorized"));
  const hrefOf = (kind: string) => (id: string | null) =>
    id ? `/app/lancamentos?m=${month}&categoria=${id}` : `/app/lancamentos?m=${month}&tipo=${kind}`;
  const expenseRows = barRows(foldCategories(data.expenses), {
    nameOf,
    hrefOf: hrefOf("despesa"),
    otherName: t("spending.other"),
  });
  const incomeRows = barRows(foldCategories(data.incomes), {
    nameOf,
    hrefOf: hrefOf("receita"),
    otherName: t("spending.other"),
  });
  const contributionRows = barRows(foldCategories(data.contributions), {
    nameOf,
    hrefOf: hrefOf("aporte"),
    otherName: t("spending.other"),
  });

  const anything = hasAnything(summary);
  const moved = hasMovement(summary);
  // Sem o módulo, o painel mostra o convite no lugar dos números: os dados ficam guardados.
  const investingOpen = canView(access, "investimentos");
  const showInvesting = investingOpen && investing.hasInvestments;
  const showDividends = investingOpen && brazilRules && investing.hasDividends;
  const cardTotal = toDbAmount(
    data.cards.reduce((acc, card) => acc.plus(card.statement), money(0)),
  );
  const sectionLinks = [
    { href: "#evolucao", label: t("cashflow.title") },
    { href: "#categorias", label: t("categories.title") },
    { href: "#contas", label: t("accounts.title") },
    ...(showInvesting ? [{ href: "#investimentos", label: t("investments.title") }] : []),
    ...(showDividends ? [{ href: "#proventos", label: t("dividends.title") }] : []),
  ];

  const header = (
    <PageHeader
      title={t("greeting", { name: firstName })}
      description={data.place ? t("todayAt", { date, place: data.place }) : t("today", { date })}
      actions={
        <div className="flex flex-wrap gap-2">
          {smartImport ? (
            <Link href="/app/importar/arquivos" className={buttonClass("secondary")}>
              <Upload className="size-4" aria-hidden="true" />
              {t("importFiles")}
            </Link>
          ) : null}
          <Link
            href={phase === "atual" ? "/app/lancamentos" : `/app/lancamentos?m=${month}`}
            className={buttonClass("secondary")}
          >
            {t("viewEntries")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      }
    />
  );

  const reserveTile = (
    <SmallTile
      href="/app/reserva"
      title={phase === "atual" ? t("reserve.title") : t("reserve.titleToday")}
      {...(reserve.baseline.basis === "sem_dados"
        ? { hint: t("reserve.define") }
        : {
            value: formatPercent(reserve.status.percent, locale),
            hint: t("reserve.progress", {
              saved: amount(reserve.status.saved),
              target: amount(reserve.status.target),
            }),
          })}
    />
  );
  const wealthTile = (
    <SmallTile
      href="/app/patrimonio"
      title={phase === "atual" ? t("wealth.title") : t("wealth.titleToday")}
      value={amount(wealth.summary.net)}
      hint={t("wealth.summary", {
        owned: amount(wealth.summary.owned),
        owed: amount(wealth.summary.owed),
      })}
    />
  );

  // Conta nova: nada de zeros. O caminho é o primeiro lançamento, e o resto só é citado.
  if (data.fresh)
    return (
      <div className="flex flex-col gap-6">
        {header}
        <FirstSteps checklist={data.checklist} />
        <Card>
          <EmptyState
            title={t("fresh.title")}
            text={t("fresh.text")}
            action={
              writable ? (
                <Link href="/app/lancamentos" className={buttonClass()}>
                  {t("fresh.action")}
                </Link>
              ) : null
            }
          />
        </Card>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <ModuleInvite
            title={t("accounts.title")}
            text={t("fresh.accounts")}
            href="/app/contas"
            action={t("fresh.accountsAction")}
          />
          <ModuleInvite
            title={t("investments.title")}
            text={t("investments.invite")}
            href="/app/investimentos"
            action={t("investments.inviteAction")}
          />
          <ModuleInvite
            title={t("reserve.title")}
            text={t("fresh.reserve")}
            href="/app/reserva"
            action={t("reserve.define")}
          />
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      {header}
      <SectionLinks items={sectionLinks} />

      {phase === "atual" && !moved ? (
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-2xl border border-line bg-card-soft px-5 py-4 text-sm">
          <span>{t("notice.emptyCurrent", { month: label })}</span>
          {previous ? (
            <Link
              href={`/app?mes=${previous}`}
              scroll={false}
              className="font-medium underline underline-offset-2"
            >
              {t("notice.seePrevious", { month: formatMonthYear(previous, locale) })}
            </Link>
          ) : null}
        </p>
      ) : null}
      {past && !anything ? (
        <p className="rounded-2xl border border-line bg-card-soft px-5 py-4 text-sm">
          {t("notice.emptyPast", { month: label })}
        </p>
      ) : null}
      {future ? (
        <p className="rounded-2xl border border-line bg-card-soft px-5 py-4 text-sm">
          {anything
            ? t("notice.future", { month: label })
            : t("notice.futureEmpty", { month: label })}
        </p>
      ) : null}

      {data.savingsNotice ? (
        <aside
          aria-label={t("savingsNotice.label")}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-line bg-card-soft px-5 py-4 text-sm"
        >
          <p className="m-0 min-w-0 flex-1 basis-64">{t("savingsNotice.text")}</p>
          {writable ? (
            <form action={dismissSavingsNotice}>
              <Button type="submit" variant="secondary" small>
                {t("savingsNotice.action")}
              </Button>
            </form>
          ) : null}
        </aside>
      ) : null}

      <section aria-label={t("stats.title", { month: label })} className="flex flex-col gap-3">
        <dl className="m-0 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <StatTile
            label={future ? t("stats.receivedPlanned") : t("stats.received")}
            tone="receita"
            icon={<ArrowDownLeft className="size-4.5" />}
            value={amount(shown.income)}
            hint={tile(summary.plannedIncome, before.income, shown.income)}
          />
          <StatTile
            label={future ? t("stats.spentPlanned") : t("stats.spent")}
            tone="despesa"
            icon={<ArrowUpRight className="size-4.5" />}
            value={amount(shown.expense)}
            hint={tile(summary.plannedExpense, before.expense, shown.expense)}
          />
          <StatTile
            label={future ? t("stats.resultPlanned") : t("stats.result")}
            icon={<Scale className="size-4.5" />}
            value={amount(future ? summary.projectedBalance : summary.balance)}
            hint={
              <>
                <span className="block">{t("stats.resultHint")}</span>
                {!future && summary.projectedBalance !== summary.balance ? (
                  <span className="block">
                    {t("stats.withPlanned", { amount: amount(summary.projectedBalance) })}
                  </span>
                ) : null}
              </>
            }
          />
          <StatTile
            label={
              past
                ? t("stats.balanceEnd")
                : future
                  ? t("stats.balanceProjected")
                  : t("stats.balance")
            }
            icon={<Landmark className="size-4.5" />}
            value={amount(data.balance.value)}
            hint={
              <>
                {past ? (
                  <span className="block">
                    {t("stats.balanceEndHint", { date: formatLongDate(data.balance.asOf, locale) })}
                  </span>
                ) : null}
                {phase === "atual" ? (
                  <span className="block">
                    {t("stats.balanceForecast", { amount: amount(data.balance.projected) })}
                  </span>
                ) : null}
                {future ? <span className="block">{t("stats.balanceProjectedHint")}</span> : null}
                {data.balance.fx?.date ? (
                  <span className="block">
                    {t("stats.balanceConverted", {
                      date: formatLongDate(data.balance.fx.date, locale),
                    })}
                  </span>
                ) : null}
                {data.balance.fx && data.balance.fx.missing.length > 0 ? (
                  <span className="block">
                    {t("stats.fxMissing", { currencies: data.balance.fx.missing.join(", ") })}
                  </span>
                ) : null}
              </>
            }
          />
        </dl>
        {spentShare === null ? null : (
          <div className="rounded-2xl border border-line bg-card px-4 py-3 shadow-card sm:px-5">
            {/* Uma barra só: o que já saiu, cheio; o que ainda vai sair, claro; o total é o que entra no mês. */}
            <div
              role="img"
              aria-label={spentText}
              className="flex h-2.5 overflow-hidden rounded-full bg-brand-100"
            >
              <div className="h-full bg-expense" style={{ width: `${spentShare.done}%` }} />
              <div className="h-full bg-expense/35" style={{ width: `${spentShare.open}%` }} />
            </div>
            <p className="m-0 mt-2 text-sm text-muted">{spentText}</p>
          </div>
        )}
        {moneyMoved ? (
          <dl
            aria-label={t("stats.savingsTitle", { month: label })}
            className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 rounded-2xl border border-line bg-card-soft px-4 py-4 sm:grid-cols-3 sm:px-5"
          >
            {[
              {
                label: future ? t("stats.contributedPlanned") : t("stats.contributed"),
                value: shown.contribution,
                hints: [
                  t("stats.contributedHint"),
                  ...(!future && !money(summary.plannedContribution).isZero()
                    ? [t(openText, { amount: amount(summary.plannedContribution) })]
                    : []),
                ],
              },
              {
                label: future
                  ? t("stats.afterContributionsPlanned")
                  : t("stats.afterContributions"),
                value: shown.afterContributions,
                hints: [t("stats.afterContributionsHint")],
              },
              ...(money(shown.redemption).isZero()
                ? []
                : [
                    {
                      label: t("stats.redeemed"),
                      value: shown.redemption,
                      hints: [t("stats.redeemedHint")],
                    },
                  ]),
            ].map((item) => (
              <div key={item.label} className="min-w-0">
                <dt className="text-xs text-muted">{item.label}</dt>
                <dd className="m-0 mt-0.5">
                  <span className="block whitespace-nowrap text-base font-semibold tabular-nums">
                    {amount(item.value)}
                  </span>
                  {item.hints.map((hint) => (
                    <span key={hint} className="mt-0.5 block text-xs text-muted">
                      {hint}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {money(cardTotal).isZero() ? null : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            <Note>{t("notes.card", { amount: amount(cardTotal) })}</Note>
          </ul>
        )}
      </section>

      <FirstSteps checklist={data.checklist} />

      <Insights screen="painel" />

      {suggestions.items.length === 0 ? null : (
        <Card
          title={t("suggestions.title")}
          actions={
            <Link
              href="/app/sugestoes"
              className="text-sm font-medium underline-offset-2 hover:underline"
            >
              {t("suggestions.viewAll", { count: suggestions.total })}
            </Link>
          }
        >
          <ul
            aria-label={t("suggestions.title")}
            className="m-0 list-none divide-y divide-line p-0"
          >
            {suggestions.items.map((item) => (
              <li key={item.id} className="py-2 text-sm font-medium first:pt-0 last:pb-0">
                {item.title}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* No computador, duas colunas: os gráficos à esquerda; o que pede ação e a lista do mês à direita. */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div id="evolucao" className="min-w-0 scroll-mt-20 xl:col-start-1 xl:row-start-1">
          <Card
            title={t("cashflow.title")}
            description={t("cashflow.description", { month: label })}
          >
            <CashflowChart series={data.series} selected={month} current={current} />
          </Card>
        </div>
        <div className="min-w-0 xl:col-start-2 xl:row-start-1">
          <Upcoming
            data={data}
            moneyText={moneyText}
            writable={writable}
            describe={(entry) =>
              system.description(entry.description, {
                category: data.categoryNames.get(entry.categoryId),
                bill: entry.source === "fatura",
              })
            }
          />
        </div>
        <div className="min-w-0 xl:col-start-2 xl:row-start-2">
          <MonthEntries
            data={data}
            label={label}
            moneyText={moneyText}
            describe={(entry) =>
              system.description(entry.description, {
                category: data.categoryNames.get(entry.categoryId),
                bill: entry.source === "fatura",
              })
            }
          />
        </div>
        <div
          id="categorias"
          className="min-w-0 scroll-mt-20 xl:col-start-1 xl:row-span-2 xl:row-start-2"
        >
          <Card
            title={t("categories.title")}
            description={t("categories.description", { month: label })}
          >
            <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-2">
              <CategoryBars
                title={future ? t("categories.expensesPlanned") : t("categories.expenses")}
                description={t("categories.expensesHint")}
                tone="despesa"
                rows={expenseRows}
                empty={t("categories.emptyExpenses")}
                money={moneyText}
              />
              <CategoryBars
                title={future ? t("categories.incomePlanned") : t("categories.income")}
                description={t("categories.incomeHint")}
                tone="receita"
                rows={incomeRows}
                empty={t("categories.emptyIncome")}
                money={moneyText}
              />
              {contributionRows.length === 0 ? null : (
                <CategoryBars
                  title={
                    future ? t("categories.contributionsPlanned") : t("categories.contributions")
                  }
                  description={t("categories.contributionsHint")}
                  tone="aporte"
                  rows={contributionRows}
                  empty=""
                  money={moneyText}
                />
              )}
            </div>
          </Card>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:gap-4 xl:col-start-2 xl:row-start-3">
          {reserveTile}
          {wealthTile}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-6">
          {data.people.list.length === 0 ? null : (
            <div id="pessoas" className="min-w-0 scroll-mt-20">
              <Card title={tPeople("title")} description={tPeople("description", { month: label })}>
                <PersonSpendingBars
                  rows={data.people.spending}
                  people={data.people.list}
                  moneyText={moneyText}
                  hrefOf={(id) =>
                    `/app/lancamentos?m=${month}&tipo=despesa&pessoa=${id ?? "comum"}`
                  }
                  texts={spendingTexts(
                    tPeople as never,
                    moneyText,
                    locale,
                    data.people.spending,
                    data.people.list,
                  )}
                />
              </Card>
            </div>
          )}
          <div id="contas" className="min-w-0 scroll-mt-20">
            <AccountsSection data={data} moneyText={moneyText} nameOf={system.name} />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {showInvesting ? (
            <div id="investimentos" className="min-w-0 scroll-mt-20">
              <InvestmentsSection data={investing} month={month} moneyText={moneyText} />
            </div>
          ) : (
            <ModuleInvite
              id="investimentos"
              title={t("investments.title")}
              text={t("investments.invite")}
              href="/app/investimentos"
              action={t("investments.inviteAction")}
            />
          )}
          {showDividends ? (
            <div id="proventos" className="min-w-0 scroll-mt-20">
              <DividendsSection data={investing} month={month} moneyText={moneyText} />
            </div>
          ) : brazilRules ? (
            <ModuleInvite
              id="proventos"
              title={t("dividends.title")}
              text={t("dividends.invite")}
              href="/app/proventos"
              action={t("dividends.inviteAction")}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
