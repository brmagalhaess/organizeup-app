"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { Button, Field, FormMessage, Input, Select } from "@/components/ui";
import { addEntry, type EntryFormState } from "./actions";

const initial: EntryFormState = { ok: false, message: null };

interface Option {
  id: string;
  name: string;
}

export function EntryForm({
  defaultDate,
  accounts,
  categories,
}: {
  defaultDate: string;
  accounts: Option[];
  categories: Array<Option & { kind: "receita" | "despesa" }>;
}) {
  const [state, action, pending] = useActionState(addEntry, initial);
  const [kind, setKind] = useState<"despesa" | "receita">("despesa");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3">
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-1.5 text-sm font-medium">Tipo</legend>
        {(
          [
            ["despesa", "Despesa"],
            ["receita", "Receita"],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold ${
              kind === value
                ? "border-brand-900 bg-brand-900 text-white"
                : "border-line bg-card text-ink"
            }`}
          >
            <input
              type="radio"
              name="kind"
              value={value}
              checked={kind === value}
              onChange={() => setKind(value)}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </fieldset>

      <Field label="Descrição" error={state.fieldErrors?.description}>
        <Input name="description" required maxLength={120} placeholder="Ex.: Conta de luz" />
      </Field>
      <div className="grid grid-cols-[2fr_3fr] gap-3">
        <Field label="Valor (R$)" error={state.fieldErrors?.amount}>
          <Input name="amount" inputMode="decimal" required placeholder="0,00" />
        </Field>
        <Field label="Data" error={state.fieldErrors?.date}>
          <Input name="date" type="date" required defaultValue={defaultDate} />
        </Field>
      </div>
      <Field label="Categoria" error={state.fieldErrors?.categoryId}>
        <Select name="categoryId" required key={kind}>
          {categories
            .filter((category) => category.kind === kind)
            .map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Conta" error={state.fieldErrors?.accountId}>
        <Select name="accountId" required>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </Field>

      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="done" defaultChecked className="size-5" />
        Já foi pago ou recebido
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="repeat" className="size-5" />
        Repete todo mês
      </label>

      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar lançamento"}
      </Button>
    </form>
  );
}
