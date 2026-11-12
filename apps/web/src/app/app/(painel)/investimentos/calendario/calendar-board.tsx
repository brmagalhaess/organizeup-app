"use client";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { cx } from "@/components/styles";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate, formatMonthYear, formatWeekdayName } from "@/i18n/format";
import { useMoney } from "@/i18n/money";
import {
  entriesByDay,
  monthGrid,
  type CalendarEntry,
  type CalendarEvent,
} from "@/lib/dividend-calendar";
import type { loadDividendCalendar } from "@/lib/dividend-calendar-data";
import { quantityText } from "../shared";

type Data = Awaited<ReturnType<typeof loadDividendCalendar>>;

/** Domingo a sábado, como o calendário brasileiro: a semana de 1º de novembro de 2026 começa no domingo. */
const WEEK = [
  "2026-11-01",
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
  "2026-11-06",
  "2026-11-07",
];

const MAX_CHIPS = 3;

function TypeDot({ type }: { type: CalendarEntry["type"] }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block size-2 shrink-0 rounded-full",
        type === "pagamento" ? "bg-success" : "bg-warning",
      )}
    />
  );
}

function EventLine({ entry, today }: { entry: CalendarEntry; today: string }) {
  const t = useTranslations("investimentos.calendar");
  const locale = useLocale();
  const moneyText = useMoney();
  const { event, type } = entry;
  const perShare = t(event.assetClass === "acao" ? "perShareStock" : "perShare", {
    amount: moneyText(event.ratePerShare),
  });
  const other =
    type === "pagamento"
      ? t("comOn", { date: formatDate(event.comDate, locale) })
      : t("payOn", { date: formatDate(event.payDate, locale) });
  return (
    <li
      className={cx(
        "flex items-start gap-3 py-2 text-sm",
        event.mine && "rounded-lg bg-brand-50/60 px-2",
      )}
    >
      <span className="mt-1.5">
        <TypeDot type={type} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 flex flex-wrap items-center gap-2 font-medium">
          {event.ticker}
          <Badge>{t(`kinds.${event.kind}`)}</Badge>
          {event.mine ? <Badge tone="success">{t("yoursBadge")}</Badge> : null}
          {event.name ? <span className="font-normal text-muted">{event.name}</span> : null}
        </p>
        <p className="m-0 text-xs text-muted">
          {t(type === "pagamento" ? "legendPay" : "legendCom")} · {perShare} · {other}
        </p>
        {event.mine ? (
          <p className="m-0 text-xs">
            {event.amount && event.quantity
              ? t("yours", {
                  quantity: quantityText(event.quantity, locale),
                  amount: moneyText(event.ratePerShare),
                  total: moneyText(event.amount),
                })
              : event.comDate <= today
                ? t("notHeld")
                : null}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function CalendarBoard({ data }: { data: Data }) {
  const t = useTranslations("investimentos.calendar");
  const tInv = useTranslations("investimentos");
  const locale = useLocale();
  const moneyText = useMoney();
  const router = useRouter();
  const weeks = monthGrid(data.month);
  const days = entriesByDay(data.events, data.month);
  const go = (month: string, mine = data.mineOnly) =>
    router.push(`/app/investimentos/calendario?mes=${month}${mine ? "&meus=1" : ""}`);
  const weekday = (date: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
      new Date(`${date}T00:00:00Z`),
    );
  const listedDays = [...days.keys()].sort();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={tInv("eyebrow")} title={t("title")} description={t("description")} />

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          {/* O mês troca no cabeçalho, igual às outras telas. */}
          <h2 className="m-0 text-base font-semibold first-letter:uppercase">
            {formatMonthYear(data.month, locale)}
          </h2>
          <div role="group" aria-label={t("mine")} className="flex gap-2">
            <Button
              variant={data.mineOnly ? "secondary" : "primary"}
              small
              aria-pressed={!data.mineOnly}
              onClick={() => go(data.month, false)}
            >
              {t("all")}
            </Button>
            <Button
              variant={data.mineOnly ? "primary" : "secondary"}
              small
              aria-pressed={data.mineOnly}
              onClick={() => go(data.month, true)}
            >
              {t("mine")}
            </Button>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted">
          {t("summary", { count: data.total, mine: data.mineCount })}
          {data.mineCount > 0 ? ` ${t("mineTotal", { amount: moneyText(data.mineTotal) })}` : ""}
          {!data.hasHoldings ? ` ${t("noHoldings")}` : ""}
        </p>
        <p className="mt-1 flex flex-wrap gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <TypeDot type="com" /> {t("legendCom")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <TypeDot type="pagamento" /> {t("legendPay")}
          </span>
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-xs">
            <caption className="sr-only">{t("grid")}</caption>
            <thead>
              <tr>
                {WEEK.map((date) => (
                  <th
                    key={date}
                    scope="col"
                    className="py-1 text-center font-medium uppercase tracking-wide text-muted"
                  >
                    {weekday(date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, index) => (
                <tr key={index}>
                  {week.map((day) => {
                    const entries = days.get(day.date) ?? [];
                    const isToday = day.date === data.today;
                    return (
                      <td
                        key={day.date}
                        className={cx(
                          "h-24 w-[14.28%] border border-line p-1 align-top",
                          !day.inMonth && "bg-card-soft text-muted",
                        )}
                      >
                        <a
                          href={entries.length > 0 ? `#dia-${day.date}` : undefined}
                          className="block h-full no-underline"
                        >
                          <span
                            className={cx(
                              "inline-flex size-6 items-center justify-center rounded-full tabular-nums",
                              isToday && "bg-brand-900 font-semibold text-white",
                            )}
                          >
                            {Number(day.date.slice(8))}
                          </span>
                          <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
                            {entries.slice(0, MAX_CHIPS).map((entry) => (
                              <li
                                key={`${entry.type}-${entry.event.id}`}
                                className={cx(
                                  "flex items-center gap-1 truncate rounded px-1",
                                  entry.event.mine
                                    ? "bg-brand-50 font-medium text-ink"
                                    : "text-muted",
                                )}
                              >
                                <TypeDot type={entry.type} />
                                <span className="truncate">{entry.event.ticker}</span>
                              </li>
                            ))}
                            {entries.length > MAX_CHIPS ? (
                              <li className="px-1 text-muted">
                                {t("more", { count: entries.length - MAX_CHIPS })}
                              </li>
                            ) : null}
                          </ul>
                        </a>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={t("byDay")}>
        {listedDays.length === 0 ? (
          <EmptyState title={t(data.mineOnly ? "emptyMine" : "empty")} />
        ) : (
          <div className="flex flex-col gap-4">
            {listedDays.map((date) => (
              <section key={date} id={`dia-${date}`} aria-label={formatWeekdayName(date, locale)}>
                <h3 className="m-0 rounded-lg bg-card-soft px-3 py-2 text-sm font-semibold capitalize">
                  {formatWeekdayName(date, locale)}
                </h3>
                <ul className="m-0 list-none divide-y divide-line p-0 px-1">
                  {days.get(date)!.map((entry) => (
                    <EventLine
                      key={`${entry.type}-${entry.event.id}`}
                      entry={entry}
                      today={data.today}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-muted">{t("note")}</p>
      </Card>
    </div>
  );
}

export type { CalendarEvent };
