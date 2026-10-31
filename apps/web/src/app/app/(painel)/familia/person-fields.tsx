"use client";
import { Field, Input, Select } from "@/components/ui";

export const WORK_STATUS_LABEL: Record<string, string> = {
  clt: "CLT (carteira assinada)",
  pj_autonomo: "PJ ou autônomo",
  servidor: "Servidor público",
  aposentado: "Aposentado(a)",
  estudante: "Estudante",
  sem_renda: "Sem renda",
  outro: "Outro",
};

const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

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
  const inss = values?.inssContributor;
  return (
    <>
      <Field label="Situação de trabalho" error={errors?.[`workStatus${suffix}`]}>
        <Select name={`workStatus${suffix}`} defaultValue={values?.workStatus ?? ""}>
          <option value="">Não informado</option>
          {Object.entries(WORK_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Contribui para o INSS?" error={errors?.[`inssContributor${suffix}`]}>
        <Select
          name={`inssContributor${suffix}`}
          defaultValue={inss === true ? "sim" : inss === false ? "nao" : ""}
        >
          <option value="">Não informado</option>
          <option value="sim">Sim</option>
          <option value="nao">Não</option>
        </Select>
      </Field>
      <Field
        label="Benefício mensal esperado (R$)"
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
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem] gap-3">
      <Field label="Dia" error={errors?.weddingDay}>
        <Input
          name="weddingDay"
          type="number"
          inputMode="numeric"
          min={1}
          max={31}
          defaultValue={values.day ?? ""}
        />
      </Field>
      <Field label="Mês" error={errors?.weddingMonth}>
        <Select name="weddingMonth" defaultValue={values.month ?? ""}>
          <option value="">Escolha</option>
          {MONTHS.map((name, index) => (
            <option key={name} value={index + 1}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Ano" error={errors?.weddingYear}>
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
