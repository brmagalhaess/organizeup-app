"use client";
import { useLocale, useTranslations } from "next-intl";
import { Field, Input, Select } from "@/components/ui";
import { monthNames } from "@/i18n/format";

export const WORK_STATUS_LABEL: Record<string, string> = {
  clt: "CLT (carteira assinada)",
  pj_autonomo: "PJ ou autônomo",
  servidor: "Servidor público",
  aposentado: "Aposentado(a)",
  estudante: "Estudante",
  sem_renda: "Sem renda",
  outro: "Outro",
};

const WORK_STATUSES = [
  "clt",
  "pj_autonomo",
  "servidor",
  "aposentado",
  "estudante",
  "sem_renda",
  "outro",
] as const;

type Errors = Record<string, string> | undefined;

export interface AdultValues {
  workStatus: string;
  inssContributor: boolean | null;
  expectedPension: string;
}

/** Linha de trabalho e previdência de um adulto. `suffix` separa os campos de várias pessoas. */
export function AdultFields({
  suffix = "",
  values,
  errors,
  pensionHint,
}: {
  suffix?: string;
  values: AdultValues | null;
  errors: Errors;
  pensionHint: string;
}) {
  const t = useTranslations("familiaOnboarding.person");
  const inss = values?.inssContributor;
  return (
    <>
      <Field label={t("workStatus")} error={errors?.[`workStatus${suffix}`]}>
        <Select name={`workStatus${suffix}`} defaultValue={values?.workStatus ?? ""}>
          <option value="">{t("notInformed")}</option>
          {WORK_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`work.${value}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("inss")} error={errors?.[`inssContributor${suffix}`]}>
        <Select
          name={`inssContributor${suffix}`}
          defaultValue={inss === true ? "sim" : inss === false ? "nao" : ""}
        >
          <option value="">{t("notInformed")}</option>
          <option value="sim">{t("yes")}</option>
          <option value="nao">{t("no")}</option>
        </Select>
      </Field>
      <Field label={t("pension")} hint={pensionHint} error={errors?.[`expectedPension${suffix}`]}>
        <Input
          name={`expectedPension${suffix}`}
          inputMode="decimal"
          defaultValue={values?.expectedPension ?? ""}
        />
      </Field>
    </>
  );
}

export interface WeddingValues {
  day: number | null;
  month: number | null;
  year: number | null;
}

export function WeddingFields({ values, errors }: { values: WeddingValues; errors: Errors }) {
  const t = useTranslations("familiaOnboarding.person");
  const locale = useLocale();
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem] gap-3">
      <Field label={t("day")} error={errors?.weddingDay}>
        <Input
          name="weddingDay"
          type="number"
          inputMode="numeric"
          min={1}
          max={31}
          defaultValue={values.day ?? ""}
        />
      </Field>
      <Field label={t("month")} error={errors?.weddingMonth}>
        <Select name="weddingMonth" defaultValue={values.month ?? ""}>
          <option value="">{t("choose")}</option>
          {monthNames(locale).map((name, index) => (
            <option key={name} value={index + 1}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("year")} error={errors?.weddingYear}>
        <Input
          name="weddingYear"
          type="number"
          inputMode="numeric"
          min={1900}
          max={2100}
          defaultValue={values.year ?? ""}
        />
      </Field>
    </div>
  );
}
