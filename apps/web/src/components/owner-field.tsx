"use client";
import { useTranslations } from "next-intl";
import { Field, Select } from "@/components/ui";

export interface OwnerChoices {
  people: Array<{ id: string; name: string }>;
  /** Quem já tem conta, cartão ou renda no nome, com a cor de cada um. */
  list: Array<{ id: string; name: string; slot: number }>;
  chosen: { accounts: Record<string, string>; cards: Record<string, string> };
  bank: { accounts: Record<string, string>; cards: Record<string, string> };
}

/** A pessoa de uma conta ou de um cartão: a escolha da tela, ou a da chave do banco. */
export function ownerOf(owners: OwnerChoices, target: "accounts" | "cards", id: string) {
  const personId = owners.chosen[target][id] ?? owners.bank[target][id];
  return owners.list.find((person) => person.id === personId);
}

/** "De quem é" a conta ou o cartão. Sem escolha vale a pessoa da chave do banco, ou o uso comum. */
export function OwnerField({
  owners,
  target,
  id,
}: {
  owners: OwnerChoices;
  target: "accounts" | "cards";
  id: string | undefined;
}) {
  const t = useTranslations("porPessoa.owner");
  if (owners.people.length < 2) return null;
  const bankPerson = id
    ? owners.people.find((person) => person.id === owners.bank[target][id])
    : undefined;
  return (
    <Field label={t("label")} hint={t(target === "accounts" ? "accountHint" : "cardHint")}>
      <Select name="personId" defaultValue={(id && owners.chosen[target][id]) || ""}>
        <option value="">{bankPerson ? t("bank", { name: bankPerson.name }) : t("shared")}</option>
        {owners.people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
