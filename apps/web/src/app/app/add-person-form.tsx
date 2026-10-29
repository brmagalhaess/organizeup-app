"use client";
import { useActionState, useEffect, useRef } from "react";
import { Button, Field, FormMessage, Input, Select } from "@/components/ui";
import { addPerson, type ActionState } from "./actions";

const initial: ActionState = { ok: false, message: null };

export function AddPersonForm() {
  const [state, action, pending] = useActionState(addPerson, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_10rem_auto] sm:items-end"
    >
      <Field label="Nome" error={state.fieldErrors?.name}>
        <Input name="name" required maxLength={120} />
      </Field>
      <Field label="Relação" error={state.fieldErrors?.relation}>
        <Select name="relation" defaultValue="conjuge" required>
          <option value="conjuge">Cônjuge</option>
          <option value="filho">Filho(a)</option>
          <option value="pai_mae">Pai/Mãe</option>
          <option value="outro">Outro</option>
        </Select>
      </Field>
      <Field label="Nascimento" error={state.fieldErrors?.birth}>
        <Input name="birth" type="month" />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Adicionar"}
      </Button>
      <div className="sm:col-span-4">
        <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      </div>
    </form>
  );
}
