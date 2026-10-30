"use client";
import { useActionState, useEffect, useRef } from "react";
import { Button, Field, FormMessage, Input, Select } from "@/components/ui";
import { addAccount, addCategory, type SimpleFormState } from "./actions";

const initial: SimpleFormState = { ok: false, message: null };

export function AccountForm() {
  const [state, action, pending] = useActionState(addAccount, initial);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-3">
      <Field label="Nome da conta">
        <Input name="name" required maxLength={80} placeholder="Ex.: Banco do dia a dia" />
      </Field>
      <Field label="Tipo">
        <Select name="type" defaultValue="corrente">
          <option value="corrente">Conta corrente</option>
          <option value="poupanca">Poupança</option>
          <option value="dinheiro">Dinheiro em espécie</option>
          <option value="investimento">Investimento</option>
        </Select>
      </Field>
      <Field label="Saldo atual (R$)" hint="Opcional. Quanto há nessa conta hoje.">
        <Input name="openingBalance" inputMode="decimal" placeholder="0,00" />
      </Field>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" variant="secondary" disabled={pending}>
        Adicionar conta
      </Button>
    </form>
  );
}

export function CategoryForm() {
  const [state, action, pending] = useActionState(addCategory, initial);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-3">
      <Field label="Nome da categoria">
        <Input name="name" required maxLength={60} placeholder="Ex.: Pet" />
      </Field>
      <Field label="Tipo">
        <Select name="kind" defaultValue="despesa">
          <option value="despesa">Despesa</option>
          <option value="receita">Receita</option>
        </Select>
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="essential" className="size-5" />É um gasto essencial
      </label>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" variant="secondary" disabled={pending}>
        Adicionar categoria
      </Button>
    </form>
  );
}
