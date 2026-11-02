"use client";
import { COMPANY_NAME_MAX, type IdentityField } from "@organizeup/domain";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Field, Input } from "@/components/ui";
import { DEFAULT_LOCALE } from "@/i18n/locales";

export type IdentityErrors = Partial<Record<IdentityField, string>>;

function Choice({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-h-11 flex-1 basis-36 cursor-pointer items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="size-5 shrink-0"
      />
      {children}
    </label>
  );
}

function ChoiceGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0 text-sm">
      <legend className="p-0 font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

const documentProps = { autoComplete: "off", autoCapitalize: "characters", spellCheck: false };

/**
 * País, tipo de cadastro e documento. Em pt-BR o Brasil já vem marcado; nos outros idiomas, outro país.
 * `personOnly`: quem chega por convite entra como pessoa, com o próprio CPF, sem escolher empresa.
 */
export function IdentityFields({
  errors,
  personOnly = false,
}: {
  errors?: IdentityErrors | undefined;
  personOnly?: boolean;
}) {
  const t = useTranslations("identity");
  const locale = useLocale();
  const [chosen, setChosen] = useState<"BR" | "outro" | null>(null);
  const [personType, setPersonType] = useState<"pf" | "pj">("pf");
  const country = chosen ?? (locale === DEFAULT_LOCALE ? "BR" : "outro");

  return (
    <>
      <ChoiceGroup legend={t("countryLegend")}>
        <Choice
          name="country"
          value="BR"
          checked={country === "BR"}
          onChange={() => setChosen("BR")}
        >
          {t("brazil")}
        </Choice>
        <Choice
          name="country"
          value="outro"
          checked={country === "outro"}
          onChange={() => setChosen("outro")}
        >
          {t("otherCountry")}
        </Choice>
      </ChoiceGroup>

      {country === "outro" ? (
        <p className="m-0 text-sm text-muted">{t("abroadNote")}</p>
      ) : (
        <>
          {personOnly ? (
            <input type="hidden" name="personType" value="pf" />
          ) : (
            <ChoiceGroup legend={t("personLegend")}>
              <Choice
                name="personType"
                value="pf"
                checked={personType === "pf"}
                onChange={() => setPersonType("pf")}
              >
                {t("personal")}
              </Choice>
              <Choice
                name="personType"
                value="pj"
                checked={personType === "pj"}
                onChange={() => setPersonType("pj")}
              >
                {t("company")}
              </Choice>
            </ChoiceGroup>
          )}
          {personType === "pj" && !personOnly ? (
            <>
              <Field label={t("cnpj")} hint={t("cnpjHint")} error={errors?.cnpj}>
                <Input name="cnpj" required maxLength={18} {...documentProps} />
              </Field>
              <Field label={t("companyName")} error={errors?.companyName}>
                <Input
                  name="companyName"
                  required
                  autoComplete="organization"
                  maxLength={COMPANY_NAME_MAX}
                />
              </Field>
              <Field label={t("responsibleCpf")} hint={t("responsibleCpfHint")} error={errors?.cpf}>
                <Input name="cpf" required maxLength={14} {...documentProps} inputMode="numeric" />
              </Field>
            </>
          ) : (
            <Field label={t("cpf")} hint={t("cpfHint")} error={errors?.cpf}>
              <Input name="cpf" required maxLength={14} {...documentProps} inputMode="numeric" />
            </Field>
          )}
        </>
      )}
    </>
  );
}
