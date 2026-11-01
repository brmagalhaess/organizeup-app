"use client";
import { axisCeiling, money, percentOf, type MonthPoint } from "@organizeup/domain";
import { useLocale, useTranslations } from "next-intl";
import { cx } from "@/components/styles";
import { EmptyState } from "@/components/ui";
import { formatAmount, formatMonthAbbr, formatMonthYear } from "@/i18n/format";

/** Barras de entradas e saídas por mês. Um eixo só; a tabela atende leitores de tela. */
export function CashflowChart({ series }: { series: MonthPoint[] }) {
  const t = useTranslations("dashboard.cashflow");
  const locale = useLocale();
  const amount = (value: string) => formatAmount(value, locale);
  const monthName = (month: string) => formatMonthYear(month, locale);
  const ceiling = axisCeiling(series.flatMap((p) => [p.received, p.spent]));
  if (money(ceiling).isZero()) return <EmptyState title={t("emptyTitle")} text={t("emptyText")} />;
  const ticks = [ceiling, money(ceiling).dividedBy(2).toFixed(2), "0"];

  return (
    <div>
      <ul className="m-0 mb-4 flex list-none gap-4 p-0 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-income" />
          {t("income")}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-expense" />
          {t("expenses")}
        </li>
      </ul>

      <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-2">
        <div className="flex h-52 flex-col justify-between text-right text-xs tabular-nums text-muted">
          {ticks.map((tick) => (
            <span key={tick} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {formatAmount(tick, locale, "compact")}
            </span>
          ))}
        </div>
        <div>
          <div className="relative flex h-52 items-stretch border-b border-line">
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 border-t border-dashed border-line"
            />
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-1/2 border-t border-dashed border-line"
            />
            {series.map((point, index) => (
              <button
                key={point.month}
                type="button"
                aria-label={t("barLabel", {
                  month: monthName(point.month),
                  received: amount(point.received),
                  spent: amount(point.spent),
                })}
                className="group relative flex min-w-0 flex-1 items-end justify-center gap-0.5 rounded-t-lg hover:bg-brand-50"
              >
                <span
                  aria-hidden="true"
                  className="w-3 rounded-t bg-income sm:w-4"
                  style={{ height: `${percentOf(point.received, ceiling)}%` }}
                />
                <span
                  aria-hidden="true"
                  className="w-3 rounded-t bg-expense sm:w-4"
                  style={{ height: `${percentOf(point.spent, ceiling)}%` }}
                />
                <span
                  aria-hidden="true"
                  className={cx(
                    "pointer-events-none absolute bottom-full z-10 mb-1 hidden w-44 rounded-xl border border-line bg-card p-3 text-left text-xs shadow-card group-hover:block group-focus-visible:block",
                    index < 2
                      ? "left-0"
                      : index > series.length - 3
                        ? "right-0"
                        : "left-1/2 -translate-x-1/2",
                  )}
                >
                  <span className="mb-1 block font-semibold first-letter:uppercase">
                    {monthName(point.month)}
                  </span>
                  <span className="flex justify-between gap-2 text-muted">
                    {t("income")}
                    <span className="font-medium tabular-nums text-ink">
                      {amount(point.received)}
                    </span>
                  </span>
                  <span className="flex justify-between gap-2 text-muted">
                    {t("expenses")}
                    <span className="font-medium tabular-nums text-ink">{amount(point.spent)}</span>
                  </span>
                  <span className="mt-1 flex justify-between gap-2 border-t border-line pt-1 text-muted">
                    {t("left")}
                    <span className="font-medium tabular-nums text-ink">
                      {amount(point.balance)}
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex text-center text-xs text-muted">
            {series.map((point) => (
              <span key={point.month} className="flex-1">
                {formatMonthAbbr(point.month, locale)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>{t("tableCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("month")}</th>
            <th scope="col">{t("income")}</th>
            <th scope="col">{t("expenses")}</th>
          </tr>
        </thead>
        <tbody>
          {series.map((point) => (
            <tr key={point.month}>
              <th scope="row">{monthName(point.month)}</th>
              <td>{amount(point.received)}</td>
              <td>{amount(point.spent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
