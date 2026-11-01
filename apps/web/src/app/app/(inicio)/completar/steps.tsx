"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { startTransition, useActionState, type MouseEvent } from "react";
import {
  AdultFields,
  WeddingFields,
  type WeddingValues,
} from "@/app/app/(painel)/familia/person-fields";
import { buttonClass } from "@/components/styles";
import { Button, Field, FormMessage, Input, Select, submitKeeping } from "@/components/ui";
import { systemTextOf } from "@/i18n/system-text";
import {
  finishOnboarding,
  saveFamilyStep,
  saveRetirementStep,
  saveTripsStep,
  type CompletarState,
} from "./actions";

const initial: CompletarState = { ok: false, message: null };

const RELATIONS = ["conjuge", "filho", "pai_mae", "outro"] as const;
const GOAL_KINDS = [
  "veiculo",
  "imovel",
  "reforma",
  "educacao",
  "compra",
  "evento",
  "outro",
] as const;

function Footer({
  pending,
  label,
  skipTo,
}: {
  pending: boolean;
  label: string;
  skipTo: number | null;
}) {
  const t = useTranslations("familiaOnboarding.complete");
  const tCommon = useTranslations("common");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : label}
      </Button>
      {skipTo ? (
        <Link href={`/app/completar?passo=${skipTo}`} className={buttonClass("ghost")}>
          {t("skip")}
        </Link>
      ) : null}
    </div>
  );
}

export function FamilyStep({
  titular,
  others,
  wedding,
}: {
  titular: { name: string; birth: string } | null;
  others: Array<{ id: string; name: string; relation: string }>;
  wedding: WeddingValues;
}) {
  const t = useTranslations("familiaOnboarding.family");
  const tComplete = useTranslations("familiaOnboarding.complete");
  const [state, action, pending] = useActionState(saveFamilyStep, initial);
  const relationLabel = (relation: string) => {
    const known = RELATIONS.find((item) => item === relation);
    return known ? t(`relations.${known}`) : relation;
  };

  function addOnly(event: MouseEvent<HTMLButtonElement>) {
    const data = new FormData(event.currentTarget.form!);
    data.set("intent", "person");
    startTransition(() => action(data));
  }

  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-6">
      {titular ? (
        <div className="rounded-xl border border-line bg-brand-50 p-4">
          <Field
            label={t("birthOf", { name: titular.name })}
            hint={t("birthHint")}
            error={state.fieldErrors?.birth}
          >
            <Input name="birth" type="month" defaultValue={titular.birth} />
          </Field>
        </div>
      ) : null}

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">{t("others")}</legend>
        {others.length > 0 ? (
          <ul aria-label={t("people")} className="m-0 list-none divide-y divide-line p-0">
            {others.map((person) => (
              <li key={person.id} className="flex justify-between gap-3 py-2 text-sm">
                <span className="truncate font-medium">{person.name}</span>
                <span className="text-muted">{relationLabel(person.relation)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {/* Muda a chave quando a pessoa entra na lista: os campos voltam a ficar vazios. */}
        <div key={others.length} className="flex flex-col gap-3">
          <Field label={t("name")} error={state.fieldErrors?.personName}>
            <Input name="personName" maxLength={120} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("relation")} error={state.fieldErrors?.personRelation}>
              <Select name="personRelation" defaultValue="conjuge">
                {RELATIONS.map((value) => (
                  <option key={value} value={value}>
                    {t(`relations.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("birth")} error={state.fieldErrors?.personBirth}>
              <Input name="personBirth" type="month" />
            </Field>
          </div>
        </div>
        <div>
          <Button type="button" variant="secondary" small disabled={pending} onClick={addOnly}>
            {t("add")}
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">{t("wedding")}</legend>
        <p className="text-xs text-muted">{t("weddingHint")}</p>
        <WeddingFields values={wedding} errors={state.fieldErrors} />
      </fieldset>

      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Footer pending={pending} label={tComplete("continue")} skipTo={2} />
    </form>
  );
}

export function RetirementStep({
  retirementYear,
  suggestion,
  targetIncome,
  expectedYield,
  adults,
}: {
  retirementYear: number | null;
  suggestion: string | null;
  targetIncome: string;
  expectedYield: string;
  adults: Array<{
    id: string;
    name: string;
    workStatus: string;
    inssContributor: boolean | null;
    expectedPension: string;
  }>;
}) {
  const t = useTranslations("familiaOnboarding.retirement");
  const tComplete = useTranslations("familiaOnboarding.complete");
  const [state, action, pending] = useActionState(saveRetirementStep, initial);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-5">
      <Field
        label={t("year")}
        error={state.fieldErrors?.retirementYear}
        {...(suggestion ? { hint: suggestion } : {})}
      >
        <Input
          name="retirementYear"
          type="number"
          inputMode="numeric"
          min={1950}
          max={2150}
          defaultValue={retirementYear ?? ""}
        />
      </Field>
      <Field label={t("income")} hint={t("incomeHint")} error={state.fieldErrors?.targetIncome}>
        <Input name="targetIncome" inputMode="decimal" defaultValue={targetIncome} />
      </Field>
      <Field label={t("yield")} hint={t("yieldHint")} error={state.fieldErrors?.expectedYield}>
        <Input name="expectedYield" inputMode="decimal" defaultValue={expectedYield} />
      </Field>

      {adults.map((adult) => (
        <fieldset key={adult.id} className="flex min-w-0 flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold">{adult.name}</legend>
          <input type="hidden" name="adultId" value={adult.id} />
          <AdultFields
            suffix={`:${adult.id}`}
            values={adult}
            errors={state.fieldErrors}
            pensionHint={t("pensionHint")}
          />
        </fieldset>
      ))}

      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Footer pending={pending} label={tComplete("continue")} skipTo={3} />
    </form>
  );
}

export function TripsStep({
  tripsPerYear,
  tripDays,
}: {
  tripsPerYear: number;
  tripDays: number | null;
}) {
  const t = useTranslations("familiaOnboarding.trips");
  const tComplete = useTranslations("familiaOnboarding.complete");
  const [state, action, pending] = useActionState(saveTripsStep, initial);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-5">
      <Field label={t("perYear")} error={state.fieldErrors?.tripsPerYear}>
        <Input
          name="tripsPerYear"
          type="number"
          inputMode="numeric"
          min={0}
          max={12}
          defaultValue={tripsPerYear}
        />
      </Field>
      <Field label={t("days")} error={state.fieldErrors?.tripDays}>
        <Input
          name="tripDays"
          type="number"
          inputMode="numeric"
          min={1}
          max={60}
          defaultValue={tripDays ?? ""}
        />
      </Field>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Footer pending={pending} label={tComplete("continue")} skipTo={4} />
    </form>
  );
}

export function GoalStep({ accounts }: { accounts: Array<{ id: string; name: string }> }) {
  const t = useTranslations("familiaOnboarding.goal");
  const tComplete = useTranslations("familiaOnboarding.complete");
  const system = systemTextOf(useTranslations("sistema"));
  const [state, action, pending] = useActionState(finishOnboarding, initial);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-5">
      <p className="text-sm text-muted">{t("optional")}</p>
      <Field label={t("name")} error={state.fieldErrors?.goalName}>
        <Input name="goalName" maxLength={80} />
      </Field>
      <Field label={t("kind")} error={state.fieldErrors?.goalKind}>
        <Select name="goalKind" defaultValue="veiculo">
          {GOAL_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`kinds.${value}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("amount")} error={state.fieldErrors?.goalAmount}>
        <Input name="goalAmount" inputMode="decimal" />
      </Field>
      <Field label={t("month")} error={state.fieldErrors?.goalMonth}>
        <Input name="goalMonth" type="month" />
      </Field>
      <Field label={t("account")} hint={t("accountHint")} error={state.fieldErrors?.goalAccount}>
        <Select name="goalAccount" defaultValue={accounts[0]?.id ?? ""}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {system.name(account.name)}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Footer pending={pending} label={tComplete("finish")} skipTo={null} />
    </form>
  );
}
