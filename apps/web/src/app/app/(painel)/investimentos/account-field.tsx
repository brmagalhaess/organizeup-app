"use client";
import { Field, Select } from "@/components/ui";

/** De onde sai o dinheiro. Vazio: a operação não mexe em conta nenhuma. */
export function AccountField({
  accounts,
  label = "Conta de onde sai o dinheiro",
}: {
  accounts: Array<{ id: string; name: string }>;
  label?: string;
}) {
  return (
    <Field label={label} hint="Vira um lançamento na conta, sem contar como gasto do mês.">
      <Select name="accountId" defaultValue={accounts[0]?.id ?? ""}>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
        <option value="">Não mexer em nenhuma conta</option>
      </Select>
    </Field>
  );
}
