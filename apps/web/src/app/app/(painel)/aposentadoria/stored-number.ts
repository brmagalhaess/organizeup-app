// Números guardados como texto ("8000.00", "6.5"), mostrados com as mesmas casas no idioma da pessoa.
import type { Locale } from "@/i18n/locales";

/** Percentual que já vem de 0 a 100: "4.00" vira "4,00%", "4.00%" e "4,00 %". */
export const percentValue = (value: string, locale: Locale) => {
  const digits = value.split(".")[1]?.length ?? 0;
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value) / 100);
};
