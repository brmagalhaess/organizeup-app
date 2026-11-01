"use client";
import { useLocale, useTranslations } from "next-intl";
import { money, percentOf, toDbAmount } from "@organizeup/domain";
import { cx } from "@/components/styles";
import { EmptyState } from "@/components/ui";
import { formatAmount, formatMonthAbbr, formatMonthYear } from "@/i18n/format";

interface Point {
  month: string;
  owned: string;
  owed: string;
  net: string;
}

/** Linha do patrimônio líquido. Um eixo só; a tabela atende leitores de tela. */
export function NetWorthChart({ points }: { points: Point[] }) {
  const t = useTranslations("patrimonio.chart");
  const locale = useLocale();
  if (points.length < 2) return <EmptyState title={t("emptyTitle")} text={t("emptyText")} />;

  const values = points.map((point) => money(point.net));
  const top = values.reduce((acc, value) => (value.gt(acc) ? value : acc));
  const bottom = values.reduce((acc, value) => (value.lt(acc) ? value : acc));
  const span = toDbAmount(top.minus(bottom));
  // Altura em % a partir de cima, com folga para a linha não encostar nas bordas.
  const heightOf = (net: string) =>
    money(span).isZero()
      ? 50
      : 90 - (percentOf(toDbAmount(money(net).minus(bottom)), span) * 80) / 100;
  const xOf = (index: number) => ((index + 0.5) / points.length) * 100;
  const line = points.map((point, index) => `${xOf(index)},${heightOf(point.net)}`).join(" ");

  return (
    <div>
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
        <div className="flex h-52 flex-col justify-between py-3 text-right text-xs tabular-nums text-muted">
          <span>{formatAmount(toDbAmount(top), locale, "compact")}</span>
          <span>{formatAmount(toDbAmount(bottom), locale, "compact")}</span>
        </div>
        <div>
          <div className="relative h-52 border-b border-line">
            <svg
              aria-hidden="true"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 size-full text-brand-500"
            >
              <polyline
                points={line}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div className="absolute inset-0 flex">
              {points.map((point, index) => (
                <button
                  key={point.month}
                  type="button"
                  aria-label={t("point", {
                    month: formatMonthYear(point.month, locale),
                    amount: formatAmount(point.net, locale),
                  })}
                  className="group relative min-w-0 flex-1 rounded-t-lg hover:bg-brand-50/60"
                >
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-brand-500"
                    style={{ top: `${heightOf(point.net)}%` }}
                  />
                  <span
                    aria-hidden="true"
                    className={cx(
                      "pointer-events-none absolute top-0 z-10 hidden w-44 rounded-xl border border-line bg-card p-3 text-left text-xs shadow-card group-hover:block group-focus-visible:block",
                      index < points.length / 2 ? "left-full" : "right-full",
                    )}
                  >
                    <span className="mb-1 block font-semibold first-letter:uppercase">
                      {formatMonthYear(point.month, locale)}
                    </span>
                    <span className="flex justify-between gap-2 text-muted">
                      {t("owned")}
                      <span className="font-medium tabular-nums text-ink">
                        {formatAmount(point.owned, locale)}
                      </span>
                    </span>
                    <span className="flex justify-between gap-2 text-muted">
                      {t("owed")}
                      <span className="font-medium tabular-nums text-ink">
                        {formatAmount(point.owed, locale)}
                      </span>
                    </span>
                    <span className="mt-1 flex justify-between gap-2 border-t border-line pt-1 text-muted">
                      {t("net")}
                      <span className="font-medium tabular-nums text-ink">
                        {formatAmount(point.net, locale)}
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-1.5 flex text-center text-xs text-muted">
            {points.map((point) => (
              <span key={point.month} className="flex-1">
                {formatMonthAbbr(point.month, locale)}
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
            <th scope="col">{t("netWorth")}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.month}>
              <th scope="row">{formatMonthYear(point.month, locale)}</th>
              <td>{formatAmount(point.net, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
