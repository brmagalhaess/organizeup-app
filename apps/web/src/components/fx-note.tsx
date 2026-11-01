"use client";
import type { FxTotalNote } from "@organizeup/domain";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/i18n/format";

/** "Convertido pela cotação de <data>", nas telas que somam contas de moedas diferentes. */
export function FxNote({ fx, className }: { fx: FxTotalNote | null; className?: string }) {
  const t = useTranslations("patrimonio.fxNote");
  const locale = useLocale();
  if (!fx || (!fx.date && fx.missing.length === 0)) return null;
  const parts = fx.date ? [t("converted", { date: formatDate(fx.date, locale) })] : [];
  if (fx.missing.length > 0) {
    const names = new Intl.ListFormat(locale, { type: "conjunction" }).format(
      fx.missing.map((currency) => t(`currency.${currency}`)),
    );
    parts.push(t("missing", { names }));
  }
  return <p className={className ?? "m-0 text-xs text-muted"}>{parts.join(" ")}</p>;
}
