"use client";
import { useTranslations } from "next-intl";
import { Field, Input, Select } from "@/components/ui";

const WORK_STATUSES = [
  "clt",
  "pj_autonomo",
  "servidor",
  "aposentado",
  "estudante",
  "sem_renda",
  "outro",
] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

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
  const t = useTranslations("pessoas");
  const inss = values?.inssContributor;
  return (
    <>
      <Field label={t("adult.workStatus")} error={errors?.[`workStatus${suffix}`]}>
        <Select name={`workStatus${suffix}`} defaultValue={values?.workStatus ?? ""}>
          <option value="">{t("adult.notInformed")}</option>
          {WORK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`workStatuses.${status}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("adult.inss")} error={errors?.[`inssContributor${suffix}`]}>
        <Select
          name={`inssContributor${suffix}`}
          defaultValue={inss === true ? "sim" : inss === false ? "nao" : ""}
        >
          <option value="">{t("adult.notInformed")}</option>
          <option value="sim">{t("adult.yes")}</option>
          <option value="nao">{t("adult.no")}</option>
        </Select>
      </Field>
      <Field
        label={t("adult.pension")}
        hint={pensionHint}
        error={errors?.[`expectedPension${suffix}`]}
      >
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
  const t = useTranslations("pessoas.wedding");
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
          {MONTHS.map((month) => (
            <option key={month} value={month}>
              {t(`months.${month}`)}
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
