"use client";
import { useLocale, useTranslations } from "next-intl";
import { money, percentOf, toDbAmount, type DividendMonth } from "@organizeup/domain";
import { cx } from "@/components/styles";
import { formatMonthAbbr, formatMonthYear } from "@/i18n/format";
import { useMoney } from "@/i18n/money";

/** Barras de proventos líquidos por mês: o pago embaixo e o anunciado em cima, no mesmo mês. A tabela atende leitores de tela. */
export function DividendsChart({ points }: { points: DividendMonth[] }) {
  const t = useTranslations("proventos.chart");
  const locale = useLocale();
  const moneyText = useMoney();
  const totalOf = (point: DividendMonth) => money(point.paid).plus(point.announced);
  const top = points.reduce(
    (acc, point) => (totalOf(point).gt(acc) ? totalOf(point) : acc),
    money(0),
  );
  const max = toDbAmount(top);
  const hasAnnounced = points.some((point) => money(point.announced).gt(0));
  const heightOf = (value: string) => (money(max).isZero() ? 0 : percentOf(value, max));
  return (
    <div>
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
        <div className="flex h-44 flex-col justify-between text-right text-xs tabular-nums text-muted">
          <span>{moneyText(max, "compact")}</span>
          <span>{t("zero")}</span>
        </div>
        <div>
          <div className="flex h-44 items-end border-b border-line">
            {points.map((point, index) => {
              const spoken = [
                `${formatMonthYear(point.month, locale)}: ${moneyText(toDbAmount(totalOf(point)))}`,
                money(point.paid).gt(0) ? `${t("paid")} ${moneyText(point.paid)}` : null,
                money(point.announced).gt(0)
                  ? `${t("announced")} ${moneyText(point.announced)}`
                  : null,
              ].filter(Boolean);
              return (
                <button
                  key={point.month}
                  type="button"
                  aria-label={spoken.join(", ")}
                  className="group relative flex h-full min-w-0 flex-1 items-end justify-center rounded-t-lg hover:bg-brand-50/60"
                >
                  <span
                    aria-hidden="true"
                    className="flex w-full max-w-5 flex-col justify-end"
                    style={{
                      height: `${heightOf(toDbAmount(totalOf(point)))}%`,
                      marginInline: "1px",
                    }}
                  >
                    {money(point.announced).gt(0) ? (
                      <span
                        className="w-full rounded-t bg-brand-200"
                        style={{
                          height: `${totalOf(point).isZero() ? 0 : percentOf(point.announced, toDbAmount(totalOf(point)))}%`,
                        }}
                      />
                    ) : null}
                    <span
                      className={cx(
                        "w-full bg-brand-500",
                        money(point.announced).gt(0) ? "" : "rounded-t",
                      )}
                      style={{
                        height: `${totalOf(point).isZero() ? 0 : percentOf(point.paid, toDbAmount(totalOf(point)))}%`,
                      }}
                    />
                  </span>
                  <span
                    aria-hidden="true"
                    className={cx(
                      "pointer-events-none absolute top-0 z-10 hidden w-40 rounded-xl border border-line bg-card p-3 text-left text-xs shadow-card group-hover:block group-focus-visible:block",
                      index < points.length / 2 ? "left-full" : "right-full",
                    )}
                  >
                    <span className="mb-1 block font-semibold first-letter:uppercase">
                      {formatMonthYear(point.month, locale)}
                    </span>
                    <span className="block tabular-nums">
                      {t("paid")}:{" "}
                      <span className="font-medium text-ink">{moneyText(point.paid)}</span>
                    </span>
                    {money(point.announced).gt(0) ? (
                      <span className="block tabular-nums">
                        {t("announced")}:{" "}
                        <span className="font-medium text-ink">{moneyText(point.announced)}</span>
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex text-center text-xs text-muted">
            {points.map((point, index) => (
              <span key={point.month} className="min-w-0 flex-1">
                <span
                  className={
                    points.length > 14
                      ? index % 3 === 0
                        ? undefined
                        : "hidden"
                      : index % 2 === 1
                        ? "hidden sm:inline"
                        : undefined
                  }
                >
                  {formatMonthAbbr(point.month, locale)}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="m-0 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm bg-brand-500" />
          {t("paid")}
        </span>
        {hasAnnounced ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm bg-brand-200" />
            {t("announced")}
          </span>
        ) : null}
      </p>

      <table className="sr-only">
        <caption>{t("caption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("month")}</th>
            <th scope="col">{t("paid")}</th>
            <th scope="col">{t("announced")}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.month}>
              <th scope="row">{formatMonthYear(point.month, locale)}</th>
              <td>{moneyText(point.paid)}</td>
              <td>{moneyText(point.announced)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
