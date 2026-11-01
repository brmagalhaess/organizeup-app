import { useLocale, useTranslations } from "next-intl";
import { money, percentOf, toDbAmount } from "@organizeup/domain";
import { cx } from "@/components/styles";
import { formatAmount } from "@/i18n/format";

interface Point {
  year: number;
  value: string;
  income: string;
}

/**
 * Carteira por ano, com a linha de quanto precisa ter investido. A renda é proporcional à carteira:
 * aparece ao passar o mouse e na tabela, sem um segundo eixo.
 */
export function DividendChart({
  points,
  targetYear,
  required,
}: {
  points: Point[];
  targetYear: number;
  required: string;
}) {
  const t = useTranslations("aposentadoria.dividendChart");
  const locale = useLocale();
  const top = points.reduce(
    (acc, point) => (money(point.value).gt(acc) ? money(point.value) : acc),
    money(required),
  );
  const max = toDbAmount(top);
  const every = Math.ceil(points.length / 6);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const summary = t("summary", {
    first: formatAmount(first.value, locale),
    firstYear: first.year,
    last: formatAmount(last.value, locale),
    lastYear: last.year,
    income: formatAmount(last.income, locale),
    required: formatAmount(required, locale),
  });
  return (
    <div>
      <div role="img" aria-label={summary} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
        <div className="flex h-40 flex-col justify-between text-right text-xs tabular-nums text-muted">
          <span>{formatAmount(max, locale, "compact")}</span>
          <span>{t("zero")}</span>
        </div>
        <div>
          <div className="relative flex h-40 items-end border-b border-line">
            <span
              className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-ink/60"
              style={{ bottom: `${percentOf(required, max)}%` }}
            />
            {points.map((point, index) => (
              <div
                key={point.year}
                className="group relative flex h-full min-w-0 flex-1 items-end justify-center rounded-t hover:bg-brand-50/60"
              >
                <span
                  className={cx(
                    "w-full rounded-t-sm",
                    point.year < targetYear ? "bg-brand-500" : "bg-brand-500/50",
                  )}
                  style={{ height: `${percentOf(point.value, max)}%`, marginInline: "1px" }}
                />
                <span
                  className={cx(
                    "pointer-events-none absolute top-0 z-10 hidden w-40 rounded-xl border border-line bg-card p-3 text-left text-xs shadow-card group-hover:block",
                    index < points.length / 2 ? "left-full" : "right-full",
                  )}
                >
                  <span className="mb-1 block font-semibold">{point.year}</span>
                  <span className="block font-medium tabular-nums text-ink">
                    {formatAmount(point.value, locale)}
                  </span>
                  <span className="block tabular-nums text-muted">
                    {t("incomePerMonth", { amount: formatAmount(point.income, locale) })}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex text-center text-xs text-muted">
            {points.map((point, index) => (
              <span key={point.year} className="min-w-0 flex-1">
                {index % every === 0 ? point.year : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">{t("note", { year: targetYear })}</p>

      <table className="sr-only">
        <caption>{t("caption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("year")}</th>
            <th scope="col">{t("portfolio")}</th>
            <th scope="col">{t("income")}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.year}>
              <th scope="row">{point.year}</th>
              <td>{formatAmount(point.value, locale)}</td>
              <td>{formatAmount(point.income, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
