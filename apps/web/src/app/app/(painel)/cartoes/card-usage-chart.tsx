"use client";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { money, percentOf, type YearMonth } from "@organizeup/domain";
import { cx } from "@/components/styles";
import { Card, EmptyState } from "@/components/ui";
import { formatMonthAbbr, formatMonthYear, formatPercent } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { useMoney } from "@/i18n/money";
import { axisTop, cardUsage, type UsageCard, type UsagePoint } from "@/lib/card-usage";

type ChartCard = UsageCard & { name: string; openMonth: YearMonth; limitAmount: string | null };

// Fatura que ainda pode mudar (em aberto, ou só com parcelas já compradas): listrada, na mesma cor.
const PENDING_FILL =
  "repeating-linear-gradient(135deg, var(--color-brand-500) 0 2px, transparent 2px 5px)";

function Swatch({ pending }: { pending?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block size-2.5 rounded-sm",
        pending ? "bg-brand-500/15" : "bg-brand-500",
      )}
      style={pending ? { backgroundImage: PENDING_FILL } : undefined}
    />
  );
}

/**
 * Colunas com o total de cada fatura: as fechadas, a em aberto e as próximas, que já têm parcelas. Um eixo só;
 * cada coluna leva à fatura do mês, e a tabela atende leitores de tela.
 */
export function CardUsageChart({
  cards,
  selected,
  viewing,
}: {
  /** Cartões ativos. */
  cards: ChartCard[];
  selected: ChartCard;
  /** Mês da fatura aberta na tela. */
  viewing: string;
}) {
  const t = useTranslations("cartoes.usage");
  const locale = useLocale() as Locale;
  const moneyText = useMoney();
  const [all, setAll] = useState(false);
  const scope = all && cards.length > 1 ? cards : [selected];
  const { points, average, change } = cardUsage(scope, selected.openMonth);
  const top = points.reduce(
    (acc, point) => (money(point.total).gt(acc) ? money(point.total) : acc),
    money(0),
  );
  const open = points.find((point) => point.state === "aberta")!;
  const limit = all ? null : selected.limitAmount;
  // Eixo até um número redondo: os rótulos ficam limpos e a maior coluna não encosta no teto.
  const axis = axisTop(top.toNumber());
  const heightOf = (point: UsagePoint) =>
    axis === 0 || money(point.total).isZero()
      ? 0
      : Math.max((Number(point.total) / axis) * 100, 1.5);
  const hrefOf = (month: string) => `/app/cartoes?c=${selected.id}&m=${month}`;

  const scopeButton = (value: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={all === value}
      onClick={() => setAll(value)}
      className={cx(
        "min-h-9 rounded-full px-3 text-sm font-medium",
        all === value ? "bg-pine text-white" : "text-muted hover:bg-brand-50",
      )}
    >
      {label}
    </button>
  );

  return (
    <Card
      title={t("title")}
      description={all ? t("textAll") : t("text", { name: selected.name })}
      actions={
        cards.length > 1 ? (
          <div
            role="group"
            aria-label={t("scopeLabel")}
            className="flex items-center gap-1 rounded-full border border-line bg-card-soft p-1"
          >
            {scopeButton(false, t("scopeCard"))}
            {scopeButton(true, t("scopeAll"))}
          </div>
        ) : undefined
      }
    >
      {top.isZero() ? (
        <EmptyState title={t("emptyTitle")} text={t("emptyText")} />
      ) : (
        <>
          <dl className="m-0 mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-card-soft p-4">
              <dt className="text-xs text-muted">{t("open")}</dt>
              <dd className="m-0 mt-1 text-xl font-semibold tabular-nums tracking-tight">
                {moneyText(open.total)}
              </dd>
            </div>
            <div className="rounded-xl bg-card-soft p-4">
              <dt className="text-xs text-muted">{t("change")}</dt>
              <dd className="m-0 mt-1 flex items-center gap-1.5 text-xl font-semibold tabular-nums tracking-tight">
                {change === null ? (
                  <span className="text-muted">{t("noChange")}</span>
                ) : (
                  <>
                    {change > 0 ? (
                      <TrendingUp className="size-5 text-danger" aria-hidden="true" />
                    ) : change < 0 ? (
                      <TrendingDown className="size-5 text-success" aria-hidden="true" />
                    ) : null}
                    <span>
                      {change > 0 ? "+" : ""}
                      {formatPercent(change, locale)}
                    </span>
                  </>
                )}
              </dd>
            </div>
            <div className="rounded-xl bg-card-soft p-4">
              <dt className="text-xs text-muted">{t("average")}</dt>
              <dd className="m-0 mt-1 text-xl font-semibold tabular-nums tracking-tight">
                {average === null ? (
                  <span className="text-muted">{t("noChange")}</span>
                ) : (
                  moneyText(average)
                )}
              </dd>
            </div>
          </dl>

          <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
            <div className="relative h-48 text-right text-xs tabular-nums text-muted">
              <span className="absolute right-0 top-0 -translate-y-1/2">
                {moneyText(String(axis), "compact")}
              </span>
              <span className="absolute right-0 top-1/2 -translate-y-1/2">
                {moneyText(String(axis / 2), "compact")}
              </span>
              <span className="absolute bottom-0 right-0 translate-y-1/2">
                {moneyText("0", "compact")}
              </span>
            </div>
            <div>
              <div className="relative h-48 border-b border-line">
                <div aria-hidden="true" className="absolute inset-x-0 top-0 border-t border-line" />
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 top-1/2 border-t border-line"
                />
                <div className="absolute inset-0 flex">
                  {points.map((point, index) => {
                    const pending = point.state !== "fechada";
                    return (
                      <Link
                        key={point.month}
                        href={hrefOf(point.month)}
                        scroll={false}
                        aria-label={t("point", {
                          month: formatMonthYear(point.month, locale),
                          amount: moneyText(point.total),
                          state: t(`state.${point.state}`),
                        })}
                        aria-current={point.month === viewing ? "true" : undefined}
                        className="group relative flex min-w-0 flex-1 items-end justify-center rounded-t-lg hover:bg-brand-50/60 focus-visible:bg-brand-50/60"
                      >
                        <span
                          aria-hidden="true"
                          className={cx(
                            "w-3/5 max-w-6 rounded-t group-hover:brightness-110",
                            pending ? "bg-brand-500/15" : "bg-brand-500",
                          )}
                          style={{
                            height: `${heightOf(point)}%`,
                            backgroundImage: pending ? PENDING_FILL : undefined,
                          }}
                        />
                        <span
                          aria-hidden="true"
                          className={cx(
                            "pointer-events-none absolute top-0 z-10 hidden w-44 rounded-xl border border-line bg-card p-3 text-left text-xs shadow-card group-hover:block group-focus-visible:block",
                            index < points.length / 2 ? "left-full" : "right-full",
                          )}
                        >
                          <span className="block text-muted first-letter:uppercase">
                            {formatMonthYear(point.month, locale)}
                          </span>
                          <span className="mt-0.5 block text-base font-semibold tabular-nums text-ink">
                            {moneyText(point.total)}
                          </span>
                          <span className="mt-1 flex items-center gap-1.5 text-muted">
                            <Swatch pending={pending} />
                            {t(`state.${point.state}`)}
                          </span>
                          {limit && money(limit).gt(0) ? (
                            <span className="mt-1 block border-t border-line pt-1 text-muted">
                              {t("limitShare", {
                                percent: formatPercent(percentOf(point.total, limit), locale),
                              })}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
              <div className="mt-1.5 flex text-center text-xs text-muted">
                {points.map((point, index) => (
                  <span
                    key={point.month}
                    className={cx(
                      "min-w-0 flex-1 whitespace-nowrap",
                      // No celular não cabem doze nomes: aparece um mês sim, um não.
                      index % 2 === 1 && "invisible sm:visible",
                      point.month === viewing && "font-semibold text-ink",
                    )}
                  >
                    {formatMonthAbbr(point.month, locale)}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <ul className="m-0 mt-4 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-xs text-muted">
            <li className="flex items-center gap-1.5">
              <Swatch />
              {t("legendClosed")}
            </li>
            <li className="flex items-center gap-1.5">
              <Swatch pending />
              {t("legendPending")}
            </li>
          </ul>

          <table className="sr-only">
            <caption>{t("caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("month")}</th>
                <th scope="col">{t("total")}</th>
                <th scope="col">{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.month}>
                  <th scope="row">{formatMonthYear(point.month, locale)}</th>
                  <td>{moneyText(point.total)}</td>
                  <td>{t(`state.${point.state}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}
