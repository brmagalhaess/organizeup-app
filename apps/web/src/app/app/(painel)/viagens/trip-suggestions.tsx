"use client";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { addMonths, money, type YearMonth } from "@organizeup/domain";
import { Badge, Card } from "@/components/ui";
import { formatMonthYear, type MoneyText } from "@/i18n/format";
import { useMoney } from "@/i18n/money";
import type { Locale } from "@/i18n/locales";
import type { TripSuggestionItem, TripSuggestions as Data } from "@/lib/suggestions";
import {
  DecisionButtons,
  SuggestionFeedback,
  useSuggestionActions,
  type SuggestionActions,
} from "../sugestoes/suggestion-controls";

/** Estimativa em reais inteiros: o centavo daria uma precisão que a tabela não tem. */
const rounded = (value: string, moneyText: MoneyText) =>
  moneyText(money(value).toDecimalPlaces(0)).replace(/[.,]00(?=\D*$)/, "");

/** "julho" neste ano, "julho de 2027" nos seguintes. */
function monthLabel(month: YearMonth, today: string, locale: Locale) {
  if (month.slice(0, 4) !== today.slice(0, 4)) return formatMonthYear(month, locale);
  return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
    new Date(`${month}-15T12:00:00Z`),
  );
}

function SuggestionCard({
  item,
  today,
  writable,
  actions,
}: {
  item: TripSuggestionItem;
  today: string;
  writable: boolean;
  actions: SuggestionActions;
}) {
  const t = useTranslations("viagens.suggestions");
  const tRegions = useTranslations("viagens.regions");
  const locale = useLocale();
  const moneyText = useMoney();
  const perPerson =
    item.perPerson ?? money(item.total).dividedBy(Math.max(1, item.personIds.length)).toString();
  const when = monthLabel(item.month, today, locale);
  const monthly = rounded(item.monthlyToSave, moneyText);
  const confidence = t(`confidence.${item.confidence}`);
  return (
    <li className="rounded-xl border border-line p-4">
      <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
        {item.name}
        {item.intentionId ? <Badge tone="success">{t("fromIntention")}</Badge> : null}
        {item.fits ? null : <Badge tone="warning">{t("overBudget")}</Badge>}
      </h3>
      <p className="mt-1 text-sm text-muted">{t("when", { when, days: item.days })}</p>
      {item.postponed ? (
        <p className="mt-1 text-sm">
          {t(item.postponed.reason === "tempo" ? "postponedTime" : "postponedBusy", {
            from: monthLabel(item.postponed.from, today, locale),
            to: when,
          })}
        </p>
      ) : null}
      <p className="mt-2 text-sm font-medium">
        {t("about", {
          total: rounded(item.total, moneyText),
          perPerson: rounded(perPerson, moneyText),
        })}
      </p>
      <p className="mt-1 text-sm">
        {item.fits
          ? t("fits", {
              amount: monthly,
              month: monthLabel(addMonths(item.month, -1), today, locale),
            })
          : t("tooMuch", { amount: monthly })}
      </p>
      <p className="mt-2 text-xs text-muted">
        {item.regionEstimate
          ? t("sourceRegion", {
              region: tRegions(item.regionEstimate.region),
              count: item.regionEstimate.destinations,
              confidence,
            })
          : t("source", { source: item.source, confidence })}
      </p>
      {writable ? (
        <DecisionButtons
          id={item.id}
          title={t("itemTitle", { name: item.name, when })}
          acceptLabel={t("accept")}
          fromIntention={Boolean(item.intentionId)}
          actions={actions}
        />
      ) : null}
    </li>
  );
}

export function TripSuggestions({ data, writable }: { data: Data; writable: boolean }) {
  const t = useTranslations("viagens.suggestions");
  const actions = useSuggestionActions();

  if (data.items.length === 0 && data.tripsPerYear === 0)
    return (
      <Card>
        <p className="text-sm">
          {t.rich("prompt", {
            link: (chunks) => (
              <Link href="/app/configuracoes" className="font-medium underline underline-offset-2">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </Card>
    );

  const { adults, children } = data;
  return (
    <Card
      title={t("title")}
      {...(data.items.length > 0
        ? {
            description: t("description", {
              year: data.tableYear,
              travelers:
                children === 0
                  ? t("adults", { adults })
                  : t("adultsAndChildren", { adults, children }),
            }),
          }
        : {})}
    >
      <SuggestionFeedback result={actions.result} />
      {data.items.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul
          aria-label={t("title")}
          className="m-0 mt-2 grid list-none grid-cols-1 gap-4 p-0 lg:grid-cols-2"
        >
          {data.items.map((item) => (
            <SuggestionCard
              key={item.id}
              item={item}
              today={data.today}
              writable={writable}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
