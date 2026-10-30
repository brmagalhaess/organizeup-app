"use client";
import { useActionState } from "react";
import { updateSettings, type ActionState } from "@/app/app/actions";
import { Button, Field, FormMessage, Input, Select } from "@/components/ui";

const initial: ActionState = { ok: false, message: null };

// Fusos do Brasil (IANA). O banco aceita qualquer fuso válido.
const BR_TIMEZONES = [
  ["America/Sao_Paulo", "Brasília (BRT)"],
  ["America/Manaus", "Amazonas (AMT)"],
  ["America/Cuiaba", "Mato Grosso (AMT)"],
  ["America/Porto_Velho", "Rondônia (AMT)"],
  ["America/Boa_Vista", "Roraima (AMT)"],
  ["America/Rio_Branco", "Acre (ACT)"],
  ["America/Noronha", "Fernando de Noronha"],
  ["America/Fortaleza", "Nordeste (BRT)"],
  ["America/Belem", "Pará/Amapá (BRT)"],
] as const;

export function SettingsForm({
  initial: values,
  disabled,
}: {
  initial: { city: string; state: string; timezone: string };
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(updateSettings, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset disabled={disabled} className="contents">
        <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
          <Field label="Cidade" error={state.fieldErrors?.city}>
            <Input name="city" defaultValue={values.city} maxLength={80} />
          </Field>
          <Field label="UF" error={state.fieldErrors?.state}>
            <Input name="state" defaultValue={values.state} maxLength={2} className="uppercase" />
          </Field>
        </div>
        <Field
          label="Fuso horário"
          hint="Define o que é “hoje” nos vencimentos."
          error={state.fieldErrors?.timezone}
        >
          <Select name="timezone" defaultValue={values.timezone}>
            {BR_TIMEZONES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={pending || disabled}>
          {pending ? "Salvando…" : "Salvar configurações"}
        </Button>
      </fieldset>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
    </form>
  );
}
