"use client";
import { useActionState } from "react";
import { Button, Field, FormMessage, Input, Select } from "@/components/ui";
import { updateSettings, type ActionState } from "./actions";

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
    <form action={action} className="flex flex-col gap-3">
      <fieldset disabled={disabled} className="contents">
        <Field label="Cidade" error={state.fieldErrors?.city}>
          <Input name="city" defaultValue={values.city} maxLength={80} />
        </Field>
        <Field label="UF" error={state.fieldErrors?.state}>
          <Input name="state" defaultValue={values.state} maxLength={2} className="uppercase" />
        </Field>
        <Field label="Fuso horário" error={state.fieldErrors?.timezone}>
          <Select name="timezone" defaultValue={values.timezone}>
            {BR_TIMEZONES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="secondary" disabled={pending || disabled}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </fieldset>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
    </form>
  );
}
