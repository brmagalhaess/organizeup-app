"use client";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import type { ReactNode } from "react";
import type { Locale } from "./locales";

const LAST_RESORT = "…";

/** Funções não atravessam do servidor para o navegador: o fallback fica deste lado também. */
export function IntlProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: AbstractIntlMessages;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      getMessageFallback={() => LAST_RESORT}
      onError={(error) => console.error("i18n_error", error.code)}
    >
      {children}
    </NextIntlClientProvider>
  );
}
