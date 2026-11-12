"use client";
import {
  addMonths,
  clampToRange,
  isYearMonth,
  pickerMonths,
  pickerYears,
  type YearMonth,
} from "@organizeup/domain";
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { buttonClass, cx } from "@/components/styles";
import { Badge, Select } from "@/components/ui";
import { monthNames } from "@/i18n/format";

/**
 * Telas que mostram um mês, e o nome do parâmetro de cada uma no endereço. O seletor do cabeçalho é o mesmo
 * em todas, e o menu leva o mês escolhido de uma para a outra.
 */
export const MONTH_ROUTES: Record<string, string> = {
  "/app": "mes",
  "/app/lancamentos": "m",
  "/app/calendario": "m",
  "/app/investimentos/calendario": "mes",
};

/** Mês que a tela está mostrando, pelo endereço. Null quando a tela não tem mês. */
export function monthOnScreen(
  pathname: string,
  params: { get(name: string): string | null },
  current: YearMonth,
): YearMonth | null {
  const name = MONTH_ROUTES[pathname];
  if (!name) return null;
  const value = params.get(name);
  return value && isYearMonth(value) ? value : current;
}

/** Endereço de uma tela já no mês escolhido. O mês de hoje fica no endereço limpo. */
export function withMonth(href: string, month: YearMonth, current: YearMonth): string {
  const name = MONTH_ROUTES[href];
  return name && month !== current ? `${href}?${name}=${month}` : href;
}

export interface MonthRange {
  /** Mês de hoje, no fuso da família. */
  current: YearMonth;
  first: YearMonth;
  last: YearMonth;
}

/**
 * Mês e ano, no endereço: voltar e compartilhar funcionam. `bar` desenha a faixa fixa do celular; sem ele,
 * vêm só os controles, para dentro do cabeçalho do computador.
 */
export function MonthBar({
  range,
  month,
  bar = false,
}: {
  range: MonthRange;
  month: YearMonth;
  bar?: boolean;
}) {
  const { current } = range;
  const t = useTranslations("shell.month");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  // Um link pode trazer um mês fora da faixa: ele entra na lista, para o seletor não mentir.
  const first = month < range.first ? month : range.first;
  const last = month > range.last ? month : range.last;
  const name = MONTH_ROUTES[pathname] ?? "mes";
  // O resto do endereço (filtros da tela) continua como está: só o mês muda.
  const hrefOf = (target: YearMonth) => {
    const next = new URLSearchParams(params.toString());
    if (target === current) next.delete(name);
    else next.set(name, target);
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };
  const go = (target: YearMonth) => start(() => router.push(hrefOf(target), { scroll: false }));
  const year = month.slice(0, 4);
  const names = monthNames(locale);
  // Classe própria: a do botão comum traz espaço lateral, que espremia a seta até virar um ponto.
  const arrow =
    "inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-card text-ink transition hover:bg-brand-50 disabled:opacity-40";

  return (
    <nav
      aria-label={t("label")}
      aria-busy={pending}
      className={cx(
        "flex items-center gap-2",
        bar
          ? "sticky top-0 z-10 flex-wrap border-b border-line bg-surface/90 px-4 py-2 backdrop-blur sm:px-6 lg:hidden"
          : "min-w-0",
        pending && "[&>*]:opacity-60",
      )}
    >
      <CalendarDays
        className={cx("size-4.5 text-muted", bar ? "hidden sm:block" : "hidden xl:block")}
        aria-hidden="true"
      />
      {month <= first ? (
        <button type="button" disabled aria-label={t("previous")} className={arrow}>
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
      ) : (
        <Link
          href={hrefOf(addMonths(month, -1))}
          scroll={false}
          aria-label={t("previous")}
          className={arrow}
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Link>
      )}
      <div className="min-w-28 flex-1 sm:w-40 sm:flex-none">
        <Select
          aria-label={t("monthLabel")}
          value={month}
          onChange={(event) => go(event.target.value as YearMonth)}
        >
          {pickerMonths(year, first, last).map((option) => (
            <option key={option} value={option}>
              {names[Number(option.slice(5)) - 1]}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-24 shrink-0">
        <Select
          aria-label={t("yearLabel")}
          value={year}
          onChange={(event) =>
            go(clampToRange(`${event.target.value}-${month.slice(5)}` as YearMonth, first, last))
          }
        >
          {pickerYears(first, last).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </div>
      {month >= last ? (
        <button type="button" disabled aria-label={t("next")} className={arrow}>
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      ) : (
        <Link
          href={hrefOf(addMonths(month, 1))}
          scroll={false}
          aria-label={t("next")}
          className={arrow}
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </Link>
      )}
      {month === current ? null : (
        <Link href={hrefOf(current)} scroll={false} className={buttonClass("ghost")}>
          {t("today")}
        </Link>
      )}
      {month > current ? (
        <Badge>
          <Clock className="size-3" aria-hidden="true" />
          {t("forecast")}
        </Badge>
      ) : month < current ? (
        <Badge>{t("past")}</Badge>
      ) : null}
    </nav>
  );
}
