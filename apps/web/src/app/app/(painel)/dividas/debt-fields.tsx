"use client";
import { useState } from "react";
import { Field, Input, Select } from "@/components/ui";

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

const DOUBT_HINT = "Confira este campo.";
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
  const [system, setSystem] = useState<DebtSystemValue>(values.system ?? "price");
  const doubt = (name: DebtFieldName) => (doubtful.has(name) ? doubtClass : undefined);
  const hint = (name: DebtFieldName, text: string) => (doubtful.has(name) ? DOUBT_HINT : text);
  const optional = (name: DebtFieldName) => (doubtful.has(name) ? { hint: DOUBT_HINT } : {});
  return (
    <>
      <Field
        label="Como são as parcelas"
        hint={hint("system", "Veja no contrato ou no boleto.")}
        error={errors?.system}
      >
        <Select
          name="system"
          value={system}
          className={doubt("system")}
          onChange={(event) => setSystem(event.target.value as DebtSystemValue)}
        >
          <option value="price">Fixas, com juros calculados aqui</option>
          <option value="sac">Diminuem a cada mês</option>
          <option value="manual">Eu informo o valor da parcela</option>
        </Select>
      </Field>
      {system === "manual" ? (
        <Field
          label="Valor da parcela (R$)"
          {...optional("installmentAmount")}
          error={errors?.installmentAmount}
        >
          <Input
            name="installmentAmount"
            inputMode="decimal"
            required
            placeholder="0,00"
            defaultValue={values.installmentAmount}
            className={doubt("installmentAmount")}
          />
        </Field>
      ) : (
        <Field
          label="Saldo devedor hoje (R$)"
          hint={hint("balance", "Quanto falta pagar, sem contar juros futuros.")}
          error={errors?.balance}
        >
          <Input
            name="balance"
            inputMode="decimal"
            required
            placeholder="0,00"
            defaultValue={values.balance}
            className={doubt("balance")}
          />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Juros ao mês (%)"
          hint={hint(
            "monthlyRate",
            system === "manual" ? "Opcional. Só ajuda a sugerir a ordem." : "Use 0 se não tiver.",
          )}
          error={errors?.monthlyRate}
        >
          <Input
            name="monthlyRate"
            inputMode="decimal"
            placeholder="0,00"
            defaultValue={values.monthlyRate}
            className={doubt("monthlyRate")}
          />
        </Field>
        <Field
          label="Parcelas que faltam"
          {...optional("installments")}
          error={errors?.installments}
        >
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
      <Field label="Próximo vencimento" {...optional("firstDueDate")} error={errors?.firstDueDate}>
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
