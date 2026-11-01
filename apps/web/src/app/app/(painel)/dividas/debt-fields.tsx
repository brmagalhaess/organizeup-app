"use client";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { toAmountInput } from "@/i18n/format";

export type DebtSystemValue = "price" | "sac" | "manual";

export interface DebtFieldValues {
  system?: DebtSystemValue;
  balance?: string;
  installmentAmount?: string;
  monthlyRate?: string;
  installments?: number | string;
  firstDueDate?: string;
}

export type DebtFieldName = keyof DebtFieldValues;

const doubtClass = "border-warning";

/**
 * Valores da dívida, os mesmos no cadastro manual e na conferência de arquivo. Na conferência, os
 * campos em `doubtful` aparecem destacados, porque a leitura não teve certeza deles.
 */
export function DebtFields({
  values = {},
  doubtful = new Set<DebtFieldName>(),
  errors,
}: {
  values?: DebtFieldValues;
  doubtful?: ReadonlySet<DebtFieldName>;
  errors?: Record<string, string> | undefined;
}) {
  const t = useTranslations("dividas.form");
  const zero = toAmountInput("0.00", useLocale());
  const [system, setSystem] = useState<DebtSystemValue>(values.system ?? "price");
  const doubt = (name: DebtFieldName) => (doubtful.has(name) ? doubtClass : undefined);
  const hint = (name: DebtFieldName, text: string) => (doubtful.has(name) ? t("doubt") : text);
  const optional = (name: DebtFieldName) => (doubtful.has(name) ? { hint: t("doubt") } : {});
  return (
    <>
      <Field label={t("system")} hint={hint("system", t("systemHint"))} error={errors?.system}>
        <Select
          name="system"
          value={system}
          className={doubt("system")}
          onChange={(event) => setSystem(event.target.value as DebtSystemValue)}
        >
          <option value="price">{t("systemPrice")}</option>
          <option value="sac">{t("systemSac")}</option>
          <option value="manual">{t("systemManual")}</option>
        </Select>
      </Field>
      {system === "manual" ? (
        <Field
          label={t("installmentAmount")}
          {...optional("installmentAmount")}
          error={errors?.installmentAmount}
        >
          <Input
            name="installmentAmount"
            inputMode="decimal"
            required
            placeholder={zero}
            defaultValue={values.installmentAmount}
            className={doubt("installmentAmount")}
          />
        </Field>
      ) : (
        <Field
          label={t("balance")}
          hint={hint("balance", t("balanceHint"))}
          error={errors?.balance}
        >
          <Input
            name="balance"
            inputMode="decimal"
            required
            placeholder={zero}
            defaultValue={values.balance}
            className={doubt("balance")}
          />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={t("monthlyRate")}
          hint={hint("monthlyRate", t(system === "manual" ? "rateOptional" : "rateZero"))}
          error={errors?.monthlyRate}
        >
          <Input
            name="monthlyRate"
            inputMode="decimal"
            placeholder={zero}
            defaultValue={values.monthlyRate}
            className={doubt("monthlyRate")}
          />
        </Field>
        <Field label={t("installments")} {...optional("installments")} error={errors?.installments}>
          <Input
            name="installments"
            type="number"
            min={1}
            max={480}
            required
            defaultValue={values.installments}
            className={doubt("installments")}
          />
        </Field>
      </div>
      <Field label={t("nextDue")} {...optional("firstDueDate")} error={errors?.firstDueDate}>
        <Input
          name="firstDueDate"
          type="date"
          required
          defaultValue={values.firstDueDate}
          className={doubt("firstDueDate")}
        />
      </Field>
    </>
  );
}
