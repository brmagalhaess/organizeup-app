"use client";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Field, FormMessage, Select } from "@/components/ui";
import { changeLocale } from "@/i18n/actions";
import { LOCALE_NAMES, LOCALES } from "@/i18n/locales";

/** Seletor de idioma, igual para quem entrou e quem não entrou. A tela muda na hora. */
export function LocaleSelect({ hint }: { hint?: string }) {
  const t = useTranslations("locale");
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <Field label={t("label")} {...(hint ? { hint } : {})}>
        <Select
          name="locale"
          value={locale}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.value;
            start(async () => setFailed(!(await changeLocale(next))));
          }}
        >
          {LOCALES.map((item) => (
            <option key={item} value={item} lang={item}>
              {LOCALE_NAMES[item]}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage message={failed ? t("failed") : null} />
    </div>
  );
}
