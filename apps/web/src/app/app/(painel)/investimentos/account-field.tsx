"use client";
import { useTranslations } from "next-intl";
import { Field, Select } from "@/components/ui";

/** De onde sai o dinheiro. Vazio: a operação não mexe em conta nenhuma. */
export function AccountField({
  accounts,
  label,
}: {
  accounts: Array<{ id: string; name: string }>;
  label?: string;
}) {
  const t = useTranslations("investimentos.account");
  return (
    <Field label={label ?? t("label")} hint={t("hint")}>
      <Select name="accountId" defaultValue={accounts[0]?.id ?? ""}>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
        <option value="">{t("none")}</option>
      </Select>
    </Field>
  );
}
