import { useLocale, useTranslations } from "next-intl";
import type { FxTotalNote } from "@organizeup/domain";
import { formatDate } from "@/i18n/format";

/** Frase das telas com conversão. Null quando não há o que dizer. */
export function useFxNoteText(fx: FxTotalNote | null): string | null {
  const t = useTranslations("contas");
  const locale = useLocale();
  if (!fx) return null;
  const parts = fx.date ? [t("fx.converted", { date: formatDate(fx.date, locale) })] : [];
  if (fx.missing.length > 0) {
    const names = fx.missing.map((currency) => t("currencyName", { currency }));
    const list = new Intl.ListFormat(locale, { type: "conjunction" }).format(names);
    parts.push(t("fx.missing", { names: list }));
  }
  return parts.join(" ");
}

/** "Convertido pela cotação de <data>", nas telas que somam contas de moedas diferentes. */
export function FxNote({ fx, className }: { fx: FxTotalNote | null; className?: string }) {
  const locale = useLocale();
  const text = useFxNoteText(fx);
  if (!text) return null;
  return (
    <p lang={locale} className={className ?? "m-0 text-xs text-muted"}>
      {text}
    </p>
  );
}
