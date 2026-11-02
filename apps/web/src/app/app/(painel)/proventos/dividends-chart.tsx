"use client";
import { useLocale, useTranslations } from "next-intl";
import { money, percentOf, toDbAmount } from "@organizeup/domain";
import { cx } from "@/components/styles";
import { formatMonthAbbr, formatMonthYear } from "@/i18n/format";
import { useMoney } from "@/i18n/money";

interface Point {
  month: string;
  net: string;
}

/** Barras de proventos líquidos por mês. Uma série só; a tabela atende leitores de tela. */
export function DividendsChart({ points }: { points: Point[] }) {
  const t = useTranslations("proventos.chart");
  const locale = useLocale();
  const moneyText = useMoney();
  const top = points.reduce(
    (acc, point) => (money(point.net).gt(acc) ? money(point.net) : acc),
    money(0),
  );
  const max = toDbAmount(top);
  return (
    <div>
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
        <div className="flex h-44 flex-col justify-between text-right text-xs tabular-nums text-muted">
          <span>{moneyText(max, "compact")}</span>
          <span>{t("zero")}</span>
        </div>
        <div>
          <div className="flex h-44 items-end border-b border-line">
            {points.map((point, index) => (
              <button
                key={point.month}
                type="button"
                aria-label={`${formatMonthYear(point.month, locale)}: ${moneyText(point.net)}`}
                className="group relative flex h-full min-w-0 flex-1 items-end justify-center rounded-t-lg hover:bg-brand-50/60"
              >
                <span
                  aria-hidden="true"
                  className="w-full max-w-5 rounded-t bg-brand-500"
                  style={{
                    height: `${money(max).isZero() ? 0 : percentOf(point.net, max)}%`,
                    marginInline: "1px",
                  }}
                />
                <span
                  aria-hidden="true"
                  className={cx(
                    "pointer-events-none absolute top-0 z-10 hidden w-36 rounded-xl border border-line bg-card p-3 text-left text-xs shadow-card group-hover:block group-focus-visible:block",
                    index < points.length / 2 ? "left-full" : "right-full",
                  )}
                >
                  <span className="mb-1 block font-semibold first-letter:uppercase">
                    {formatMonthYear(point.month, locale)}
                  </span>
                  <span className="font-medium tabular-nums text-ink">{moneyText(point.net)}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex text-center text-xs text-muted">
            {points.map((point, index) => (
              <span key={point.month} className="min-w-0 flex-1">
                <span className={index % 2 === 1 ? "hidden sm:inline" : undefined}>
                  {formatMonthAbbr(point.month, locale)}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>{t("caption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("month")}</th>
            <th scope="col">{t("net")}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.month}>
              <th scope="row">{formatMonthYear(point.month, locale)}</th>
              <td>{moneyText(point.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
