"use client";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { updatePlan, updateSettings, type ActionState } from "@/app/app/actions";
import { Button, Field, FormMessage, Input, Select, submitKeeping } from "@/components/ui";

const initial: ActionState = { ok: false, message: null };

// Fusos do Brasil (IANA). O banco aceita qualquer fuso válido.
const BR_TIMEZONES = [
  ["America/Sao_Paulo", "brasilia"],
  ["America/Manaus", "amazonas"],
  ["America/Cuiaba", "matoGrosso"],
  ["America/Porto_Velho", "rondonia"],
  ["America/Boa_Vista", "roraima"],
  ["America/Rio_Branco", "acre"],
  ["America/Noronha", "noronha"],
  ["America/Fortaleza", "nordeste"],
  ["America/Belem", "para"],
] as const;

export function SettingsForm({
  initial: values,
  disabled,
}: {
  initial: { city: string; state: string; timezone: string };
  disabled: boolean;
}) {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(updateSettings, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset disabled={disabled} className="contents">
        <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
          <Field label={t("home.city")} error={state.fieldErrors?.city}>
            <Input name="city" defaultValue={values.city} maxLength={80} />
          </Field>
          <Field label={t("home.state")} error={state.fieldErrors?.state}>
            <Input name="state" defaultValue={values.state} maxLength={2} className="uppercase" />
          </Field>
        </div>
        <Field
          label={t("home.timezone")}
          hint={t("home.timezoneHint")}
          error={state.fieldErrors?.timezone}
        >
          <Select name="timezone" defaultValue={values.timezone}>
            {BR_TIMEZONES.map(([id, label]) => (
              <option key={id} value={id}>
                {t(`timezones.${label}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={pending || disabled}>
          {pending ? tCommon("saving") : t("home.save")}
        </Button>
      </fieldset>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
    </form>
  );
}

export function PlanForm({
  values,
  disabled,
}: {
  values: { retirementYear: number | null; tripsPerYear: number; tripDays: number | null };
  disabled: boolean;
}) {
  const t = useTranslations("settings.plan");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(updatePlan, initial);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <fieldset disabled={disabled} className="contents">
        <Field label={t("retirementYear")} error={state.fieldErrors?.retirementYear}>
          <Input
            name="retirementYear"
            type="number"
            inputMode="numeric"
            min={1950}
            max={2150}
            defaultValue={values.retirementYear ?? ""}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("tripsPerYear")} error={state.fieldErrors?.tripsPerYear}>
            <Input
              name="tripsPerYear"
              type="number"
              inputMode="numeric"
              min={0}
              max={12}
              defaultValue={values.tripsPerYear}
            />
          </Field>
          <Field label={t("tripDays")} error={state.fieldErrors?.tripDays}>
            <Input
              name="tripDays"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              defaultValue={values.tripDays ?? ""}
            />
          </Field>
        </div>
        <Button type="submit" disabled={pending || disabled}>
          {pending ? tCommon("saving") : t("save")}
        </Button>
      </fieldset>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
    </form>
  );
}
