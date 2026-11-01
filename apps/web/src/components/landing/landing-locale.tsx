"use client";
import { useLocale, useTranslations } from "next-intl";
import { useTransition, type MouseEvent } from "react";
import { changeLocale } from "@/i18n/actions";
import { LANDING_PATHS, LOCALE_NAMES, LOCALES, type Locale } from "@/i18n/locales";

const SHORT_NAMES: Record<Locale, string> = { "pt-BR": "PT", en: "EN", es: "ES" };

/**
 * Links, para a busca seguir de um idioma ao outro sem JavaScript. Com JavaScript, guardam a escolha
 * antes de sair: sem isso, `/` voltaria ao idioma do navegador. A troca recarrega a página de
 * propósito, porque o layout raiz não se monta de novo numa navegação entre telas.
 */
export function LandingLocale({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("landing");
  const current = useLocale();
  const [pending, start] = useTransition();

  const choose = (event: MouseEvent<HTMLAnchorElement>, locale: Locale) => {
    event.preventDefault();
    start(async () => {
      await changeLocale(locale).catch(() => false);
      window.location.assign(LANDING_PATHS[locale]);
    });
  };

  return (
    <div
      role="group"
      aria-label={t("language")}
      aria-busy={pending}
      className={`flex flex-wrap items-center gap-x-1 ${className}`}
    >
      {LOCALES.map((locale) => (
        <a
          key={locale}
          href={LANDING_PATHS[locale]}
          hrefLang={locale}
          lang={locale}
          {...(compact ? { "aria-label": LOCALE_NAMES[locale] } : {})}
          {...(locale === current ? { "aria-current": "true" as const } : {})}
          onClick={(event) => choose(event, locale)}
          className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-2 hover:underline ${
            locale === current ? "font-semibold underline underline-offset-4" : ""
          }`}
        >
          {compact ? SHORT_NAMES[locale] : LOCALE_NAMES[locale]}
        </a>
      ))}
    </div>
  );
}
