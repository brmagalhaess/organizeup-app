"use client";
import { axisCeiling, money, percentOf, type MonthPlanPoint } from "@organizeup/domain";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { cx } from "@/components/styles";
import { formatMonthAbbr, formatMonthYear } from "@/i18n/format";
import { useMoney } from "@/i18n/money";

/** Uma coluna: o feito cheio, encostado na base, e o previsto claro por cima. */
function Column({
  done,
  planned,
  ceiling,
  tone,
}: {
  done: string;
  planned: string;
  ceiling: string;
  tone: "income" | "expense";
}) {
  const hasDone = !money(done).isZero();
  const hasPlanned = !money(planned).isZero();
  return (
    <span aria-hidden="true" className="flex h-full w-1.5 flex-col justify-end sm:w-2.5 md:w-3">
      {hasPlanned ? (
        <span
          className={cx(
            "block rounded-t",
            hasDone && "mb-0.5",
            tone === "income" ? "bg-income/35" : "bg-expense/35",
          )}
          style={{ height: `${percentOf(planned, ceiling)}%` }}
        />
      ) : null}
      {hasDone ? (
        <span
          className={cx(
            "block",
            !hasPlanned && "rounded-t",
            tone === "income" ? "bg-income" : "bg-expense",
          )}
          style={{ height: `${percentOf(done, ceiling)}%` }}
        />
      ) : null}
    </span>
  );
}

/**
 * Receitas e despesas de 12 meses, no mesmo eixo, com o mês escolhido em destaque. Cada mês é um link
 * para ele; a tabela atende leitores de tela e o tooltip nunca é o único caminho para o valor.
 */
export function CashflowChart({
  series,
  selected,
  current,
}: {
  series: MonthPlanPoint[];
  selected: string;
  current: string;
}) {
  const t = useTranslations("dashboard.cashflow");
  const locale = useLocale();
  const moneyText = useMoney();
  const amount = (value: string) => moneyText(value);
  const monthName = (month: string) => formatMonthYear(month, locale);
  const totalIn = (p: MonthPlanPoint) => money(p.received).plus(p.plannedIncome).toFixed(2);
  const totalOut = (p: MonthPlanPoint) => money(p.spent).plus(p.plannedExpense).toFixed(2);
  const ceiling = axisCeiling(series.flatMap((p) => [totalIn(p), totalOut(p)]));
  if (money(ceiling).isZero()) return <p className="text-sm text-muted">{t("emptyText")}</p>;
  const ticks = [ceiling, money(ceiling).dividedBy(2).toFixed(2), "0"];
  const hasPlanned = series.some(
    (p) => !money(p.plannedIncome).isZero() || !money(p.plannedExpense).isZero(),
  );

  return (
    <div>
      <ul className="m-0 mb-4 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-income" />
          {t("income")}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-expense" />
          {t("expenses")}
        </li>
        {hasPlanned ? (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="flex gap-0.5">
              <span className="h-2.5 w-1.5 rounded-sm bg-income/35" />
              <span className="h-2.5 w-1.5 rounded-sm bg-expense/35" />
            </span>
            {t("planned")}
          </li>
        ) : null}
      </ul>

      <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-1.5 sm:gap-2">
        <div className="flex h-52 flex-col justify-between text-right text-xs tabular-nums text-muted">
          {ticks.map((tick) => (
            <span key={tick} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {moneyText(tick, "compact")}
            </span>
          ))}
        </div>
        <div>
          <div className="relative flex h-52 items-stretch border-b border-line">
            <div aria-hidden="true" className="absolute inset-x-0 top-0 border-t border-line" />
            <div aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t border-line" />
            {series.map((point, index) => {
              const open =
                !money(point.plannedIncome).isZero() || !money(point.plannedExpense).isZero();
              return (
                <Link
                  key={point.month}
                  href={point.month === current ? "/app" : `/app?mes=${point.month}`}
                  prefetch={false}
                  scroll={false}
                  aria-current={point.month === selected ? "true" : undefined}
                  aria-label={t("barLabel", {
                    month: monthName(point.month),
                    received: amount(point.received),
                    spent: amount(point.spent),
                  })}
                  className={cx(
                    "group relative flex min-w-0 flex-1 items-end justify-center gap-0.5 rounded-t-lg hover:bg-brand-50",
                    point.month === selected && "border-t-2 border-brand-500 bg-brand-50",
                  )}
                >
                  <Column
                    done={point.received}
                    planned={point.plannedIncome}
                    ceiling={ceiling}
                    tone="income"
                  />
                  <Column
                    done={point.spent}
                    planned={point.plannedExpense}
                    ceiling={ceiling}
                    tone="expense"
                  />
                  <span
                    aria-hidden="true"
                    className={cx(
                      "pointer-events-none absolute bottom-full z-10 mb-1 hidden w-48 rounded-xl border border-line bg-card p-3 text-left text-xs shadow-card group-hover:block group-focus-visible:block",
                      index < 3
                        ? "left-0"
                        : index > series.length - 4
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
                      <span className="font-medium tabular-nums text-ink">
                        {amount(point.spent)}
                      </span>
                    </span>
                    {open ? (
                      <>
                        <span className="flex justify-between gap-2 text-muted">
                          {t("plannedIncome")}
                          <span className="font-medium tabular-nums text-ink">
                            {amount(point.plannedIncome)}
                          </span>
                        </span>
                        <span className="flex justify-between gap-2 text-muted">
                          {t("plannedExpense")}
                          <span className="font-medium tabular-nums text-ink">
                            {amount(point.plannedExpense)}
                          </span>
                        </span>
                      </>
                    ) : null}
                    <span className="mt-1 flex justify-between gap-2 border-t border-line pt-1 text-muted">
                      {t("left")}
                      <span className="font-medium tabular-nums text-ink">
                        {amount(point.balance)}
                      </span>
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
          <div aria-hidden="true" className="mt-1.5 flex text-center text-[10px] sm:text-xs">
            {series.map((point) => (
              <span
                key={point.month}
                className={cx(
                  "min-w-0 flex-1",
                  point.month === selected ? "font-semibold text-ink" : "text-muted",
                )}
              >
                {formatMonthAbbr(point.month, locale)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="sr-only">
        <table>
          <caption>{t("tableCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("month")}</th>
              <th scope="col">{t("income")}</th>
              <th scope="col">{t("expenses")}</th>
              <th scope="col">{t("plannedIncome")}</th>
              <th scope="col">{t("plannedExpense")}</th>
            </tr>
          </thead>
          <tbody>
            {series.map((point) => (
              <tr key={point.month}>
                <th scope="row">{monthName(point.month)}</th>
                <td>{amount(point.received)}</td>
                <td>{amount(point.spent)}</td>
                <td>{amount(point.plannedIncome)}</td>
                <td>{amount(point.plannedExpense)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
