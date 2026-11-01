import { AlertCircle, ArrowRight, Clock } from "lucide-react";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { canWrite } from "@organizeup/db";
import { money, percentChange, percentOf, toDbAmount, yearMonthOf } from "@organizeup/domain";
import { ConfirmEntryButton } from "@/components/confirm-entry-button";
import { amountClass, buttonClass, confirmAction, cx } from "@/components/styles";
import { Badge, Card, EmptyState, PageHeader, StatTile } from "@/components/ui";
import { Insights } from "@/components/insights/insights";
import {
  formatAmount,
  formatDayMonth,
  formatLongDate,
  formatMonthYear,
  formatPercent,
} from "@/i18n/format";
import { loadOverview } from "@/lib/finance-data";
import { requireTenant } from "@/lib/session";
import { loadTopSuggestions } from "@/lib/suggestions";
import { loadNetWorth, loadReserve } from "@/lib/wealth";
import { systemTextOf } from "@/i18n/system-text";
import { CashflowChart } from "./cashflow-chart";
import { FirstSteps } from "./first-steps";

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

export default async function OverviewPage() {
  const { session, ctx } = await requireTenant();
  const [data, reserve, wealth, suggestions] = await Promise.all([
    loadOverview(ctx),
    loadReserve(ctx),
    loadNetWorth(ctx, { record: false }),
    loadTopSuggestions(ctx),
  ]);
  const [t, tSystem, locale] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("sistema"),
    getLocale(),
  ]);
  const system = systemTextOf(tSystem);
  const writable = canWrite(ctx);
  const firstName = session.user.name.split(" ")[0] ?? "";
  const date = formatLongDate(data.today, locale);
  const amount = (value: string) => formatAmount(value, locale);

  /** Compara com o mês anterior em texto, sem depender de cor. */
  const comparison = (current: string, previous: string) => {
    const change = percentChange(current, previous);
    if (change === null) return t("comparison.noBase");
    if (change === 0) return t("comparison.same");
    const percent = formatPercent(Math.abs(change), locale);
    return change > 0 ? t("comparison.more", { percent }) : t("comparison.less", { percent });
  };

  const top = data.byCategory.slice(0, 6);
  const rest = data.byCategory.slice(6).reduce((acc, c) => acc.plus(c.amount), money(0));
  const bars = [
    ...top.map((c) => ({
      id: c.categoryId,
      name: system.name(data.categoryNames.get(c.categoryId) ?? t("spending.uncategorized")),
      amount: c.amount,
    })),
    ...(rest.isZero()
      ? []
      : [{ id: "outras", name: t("spending.other"), amount: toDbAmount(rest) }]),
  ];
  const spentTotal = toDbAmount(data.byCategory.reduce((acc, c) => acc.plus(c.amount), money(0)));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("greeting", { name: firstName })}
        description={data.place ? t("todayAt", { date, place: data.place }) : t("today", { date })}
        actions={
          <Link href="/app/lancamentos" className={buttonClass("secondary")}>
            {t("viewEntries")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        }
      />

      <Insights screen="painel" />

      <FirstSteps checklist={data.checklist} />

      <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile
          label={t("stats.balance")}
          value={amount(data.total)}
          hint={
            data.fx?.date
              ? t("stats.balanceConverted", { date: formatLongDate(data.fx.date, locale) })
              : t("stats.balanceHint")
          }
        />
        <StatTile
          label={t("stats.received")}
          tone="receita"
          value={amount(data.summary.received)}
          hint={comparison(data.summary.received, data.previousSummary.received)}
        />
        <StatTile
          label={t("stats.spent")}
          tone="despesa"
          value={amount(data.summary.spent)}
          hint={comparison(data.summary.spent, data.previousSummary.spent)}
        />
        <StatTile
          label={t("stats.forecast")}
          value={amount(data.summary.projectedBalance)}
          hint={t("stats.forecastHint")}
        />
      </dl>

      <Card
        title={t("suggestions.title")}
        actions={
          <Link
            href="/app/sugestoes"
            className="text-sm font-medium underline-offset-2 hover:underline"
          >
            {suggestions.total > 0
              ? t("suggestions.viewAll", { count: suggestions.total })
              : t("suggestions.open")}
          </Link>
        }
      >
        {suggestions.items.length === 0 ? (
          <p className="text-sm text-muted">{t("suggestions.empty")}</p>
        ) : (
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
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/app/reserva"
          className="rounded-2xl border border-line bg-card p-5 shadow-card transition hover:border-brand-500"
        >
          <p className="text-sm text-muted">{t("reserve.title")}</p>
          {reserve.baseline.basis === "sem_dados" ? (
            <p className="mt-2 text-sm font-medium">{t("reserve.define")}</p>
          ) : (
            <>
              <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
                {formatPercent(reserve.status.percent, locale)}
              </p>
              <p className="mt-1 text-xs text-muted">
                {t("reserve.progress", {
                  saved: amount(reserve.status.saved),
                  target: amount(reserve.status.target),
                })}
              </p>
            </>
          )}
        </Link>
        <Link
          href="/app/patrimonio"
          className="rounded-2xl border border-line bg-card p-5 shadow-card transition hover:border-brand-500"
        >
          <p className="text-sm text-muted">{t("wealth.title")}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
            {amount(wealth.summary.net)}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t("wealth.summary", {
              owned: amount(wealth.summary.owned),
              owed: amount(wealth.summary.owed),
            })}
          </p>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title={t("cashflow.title")} description={t("cashflow.description")}>
          <CashflowChart series={data.series} />
        </Card>

        <Card
          title={t("upcoming.title")}
          description={t("upcoming.description")}
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
            <EmptyState title={t("upcoming.emptyTitle")} text={t("upcoming.emptyText")} />
          ) : (
            <ul className="m-0 list-none divide-y divide-line p-0" aria-label={t("upcoming.title")}>
              {data.pending.map((entry) => (
                <li key={`${entry.key}:${entry.date}`} className="flex items-center gap-3 py-2.5">
                  <span className="w-12 shrink-0 text-sm tabular-nums text-muted">
                    {formatDayMonth(entry.date, locale)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {system.description(entry.description, {
                        category: data.categoryNames.get(entry.categoryId),
                        bill: entry.source === "fatura",
                      })}
                    </p>
                    <p className={cx("text-xs font-medium tabular-nums", amountClass(entry.kind))}>
                      {entry.kind === "receita" ? "+ " : "− "}
                      {amount(entry.amount)}
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
      </div>

      <Card
        title={t("spending.title")}
        description={t("spending.description", { month: formatMonthYear(data.month, locale) })}
      >
        {bars.length === 0 ? (
          <EmptyState title={t("spending.emptyTitle")} text={t("spending.emptyText")} />
        ) : (
          <ul className="m-0 grid list-none gap-x-10 gap-y-3 p-0 lg:grid-cols-2">
            {bars.map((bar) => (
              <li key={bar.id}>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="truncate">{bar.name}</span>
                  <span className="whitespace-nowrap tabular-nums text-muted">
                    {amount(bar.amount)} ·{" "}
                    {formatPercent(Math.round(percentOf(bar.amount, spentTotal)), locale)}
                  </span>
                </div>
                <div aria-hidden="true" className="mt-1 h-2 rounded-full bg-brand-50">
                  <div
                    className="h-full rounded-full bg-expense"
                    style={{ width: `${percentOf(bar.amount, spentTotal)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
