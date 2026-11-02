"use client";
import { clampToRange, pickerMonths, pickerYears, type DashboardPeriod } from "@organizeup/domain";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { buttonClass, cx } from "@/components/styles";
import { Badge, Select } from "@/components/ui";
import { monthNames } from "@/i18n/format";

/** Mês atual fica no endereço limpo: é o que "Hoje" e o menu abrem. */
const monthHref = (month: string, current: string) =>
  month === current ? "/app" : `/app?mes=${month}`;

function Arrow({
  to,
  current,
  label,
  children,
}: {
  to: string | null;
  current: string;
  label: string;
  children: React.ReactNode;
}) {
  const shape = cx(buttonClass("secondary"), "w-11 shrink-0 px-0");
  if (to === null)
    return (
      <button type="button" disabled aria-label={label} className={shape}>
        {children}
      </button>
    );
  return (
    <Link href={monthHref(to, current)} scroll={false} aria-label={label} className={shape}>
      {children}
    </Link>
  );
}

/** Mês e ano do painel, no endereço: voltar e compartilhar funcionam. */
export function MonthPicker({ period }: { period: DashboardPeriod }) {
  const { month, current, first, last, previous, next, phase } = period;
  const t = useTranslations("dashboard.picker");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (target: string) =>
    start(() => router.push(monthHref(target, current), { scroll: false }));
  const year = month.slice(0, 4);
  const names = monthNames(locale);

  return (
    <nav
      aria-label={t("label")}
      aria-busy={pending}
      className={cx("flex flex-wrap items-center gap-2", pending && "opacity-60")}
    >
      <Arrow to={previous} current={current} label={t("previous")}>
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Arrow>
      <div className="min-w-32 flex-1 sm:w-44 sm:flex-none">
        <Select aria-label={t("month")} value={month} onChange={(event) => go(event.target.value)}>
          {pickerMonths(year, first, last).map((option) => (
            <option key={option} value={option}>
              {names[Number(option.slice(5)) - 1]}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-24 shrink-0">
        <Select
          aria-label={t("year")}
          value={year}
          onChange={(event) =>
            go(clampToRange(`${event.target.value}-${month.slice(5)}`, first, last))
          }
        >
          {pickerYears(first, last).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </div>
      <Arrow to={next} current={current} label={t("next")}>
        <ChevronRight className="size-4" aria-hidden="true" />
      </Arrow>
      {month === current ? null : (
        <Link href="/app" scroll={false} className={buttonClass("ghost")}>
          {t("today")}
        </Link>
      )}
      {phase === "futuro" ? (
        <Badge>
          <Clock className="size-3" aria-hidden="true" />
          {t("forecast")}
        </Badge>
      ) : null}
    </nav>
  );
}
