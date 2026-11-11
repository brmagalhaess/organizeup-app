"use client";
import { useTranslations } from "next-intl";
import { Field, Select } from "@/components/ui";
import { systemTextOf } from "@/i18n/system-text";

/** De onde sai o dinheiro. Vazio: a operação não mexe em conta nenhuma. */
export function AccountField({
  accounts,
  label,
  value,
}: {
  accounts: Array<{ id: string; name: string }>;
  label?: string;
  /** Conta já ligada à operação (edição); null é "nenhuma". Sem passar, a primeira da lista. */
  value?: string | null;
}) {
  const t = useTranslations("investimentos.account");
  const system = systemTextOf(useTranslations("sistema"));
  return (
    <Field label={label ?? t("label")} hint={t("hint")}>
      <Select
        name="accountId"
        defaultValue={value === undefined ? (accounts[0]?.id ?? "") : (value ?? "")}
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {system.name(account.name)}
          </option>
        ))}
        <option value="">{t("none")}</option>
      </Select>
    </Field>
  );
}
