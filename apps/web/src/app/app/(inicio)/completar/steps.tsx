"use client";
import Link from "next/link";
import { startTransition, useActionState, type MouseEvent } from "react";
import {
  AdultFields,
  WeddingFields,
  type WeddingValues,
} from "@/app/app/(painel)/familia/person-fields";
import { buttonClass } from "@/components/styles";
import { Button, Field, FormMessage, Input, Select, submitKeeping } from "@/components/ui";
import {
  finishOnboarding,
  saveFamilyStep,
  saveRetirementStep,
  saveTripsStep,
  type CompletarState,
} from "./actions";

const initial: CompletarState = { ok: false, message: null };

const RELATION_LABEL: Record<string, string> = {
  conjuge: "Cônjuge",
  filho: "Filho(a)",
  pai_mae: "Pai/Mãe",
  outro: "Outro",
};

const GOAL_KIND_LABEL: Record<string, string> = {
  veiculo: "Carro ou moto",
  imovel: "Casa ou apartamento",
  reforma: "Reforma",
  educacao: "Estudos",
  compra: "Compra",
  evento: "Festa ou evento",
  outro: "Outro",
};

function Footer({
  pending,
  label,
  skipTo,
}: {
  pending: boolean;
  label: string;
  skipTo: number | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : label}
      </Button>
      {skipTo ? (
        <Link href={`/app/completar?passo=${skipTo}`} className={buttonClass("ghost")}>
          Pular por agora
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
  const [state, action, pending] = useActionState(saveFamilyStep, initial);

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
            label={`Nascimento de ${titular.name}`}
            hint="Só mês e ano. É a base do plano de aposentadoria."
            error={state.fieldErrors?.birth}
          >
            <Input name="birth" type="month" defaultValue={titular.birth} />
          </Field>
        </div>
      ) : null}

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">Outras pessoas</legend>
        {others.length > 0 ? (
          <ul aria-label="Pessoas da família" className="m-0 list-none divide-y divide-line p-0">
            {others.map((person) => (
              <li key={person.id} className="flex justify-between gap-3 py-2 text-sm">
                <span className="truncate font-medium">{person.name}</span>
                <span className="text-muted">
                  {RELATION_LABEL[person.relation] ?? person.relation}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {/* Muda a chave quando a pessoa entra na lista: os campos voltam a ficar vazios. */}
        <div key={others.length} className="flex flex-col gap-3">
          <Field label="Nome" error={state.fieldErrors?.personName}>
            <Input name="personName" maxLength={120} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Relação" error={state.fieldErrors?.personRelation}>
              <Select name="personRelation" defaultValue="conjuge">
                {Object.entries(RELATION_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nascimento" error={state.fieldErrors?.personBirth}>
              <Input name="personBirth" type="month" />
            </Field>
          </div>
        </div>
        <div>
          <Button type="button" variant="secondary" small disabled={pending} onClick={addOnly}>
            Adicionar pessoa
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">Casamento</legend>
        <p className="text-xs text-muted">
          Opcional. Com o dia, entra no calendário como “Aniversário de casamento”.
        </p>
        <WeddingFields values={wedding} errors={state.fieldErrors} />
      </fieldset>

      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Footer pending={pending} label="Continuar" skipTo={2} />
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
  const [state, action, pending] = useActionState(saveRetirementStep, initial);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-5">
      <Field
        label="Ano em que querem parar"
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
      <Field
        label="Renda que você quer por mês"
        hint="Vazio: usamos seu gasto médio"
        error={state.fieldErrors?.targetIncome}
      >
        <Input name="targetIncome" inputMode="decimal" defaultValue={targetIncome} />
      </Field>
      <Field
        label="Rendimento anual da carteira (%)"
        hint="Quanto a carteira paga em proventos por ano. Ex.: R$ 100 mil que pagam R$ 6 mil = 6%."
        error={state.fieldErrors?.expectedYield}
      >
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
            pensionHint="Se não sabe, pule; dá para preencher depois em Família"
          />
        </fieldset>
      ))}

      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Footer pending={pending} label="Continuar" skipTo={3} />
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
  const [state, action, pending] = useActionState(saveTripsStep, initial);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-5">
      <Field label="Quantas viagens por ano" error={state.fieldErrors?.tripsPerYear}>
        <Input
          name="tripsPerYear"
          type="number"
          inputMode="numeric"
          min={0}
          max={12}
          defaultValue={tripsPerYear}
        />
      </Field>
      <Field label="Quantos dias costumam durar" error={state.fieldErrors?.tripDays}>
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
      <Footer pending={pending} label="Continuar" skipTo={4} />
    </form>
  );
}

export function GoalStep({ accounts }: { accounts: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState(finishOnboarding, initial);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        Opcional. Sem uma meta em mente? Deixe em branco e conclua.
      </p>
      <Field label="Nome da meta" error={state.fieldErrors?.goalName}>
        <Input name="goalName" maxLength={80} />
      </Field>
      <Field label="Tipo" error={state.fieldErrors?.goalKind}>
        <Select name="goalKind" defaultValue="veiculo">
          {Object.entries(GOAL_KIND_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Quanto custa (R$)" error={state.fieldErrors?.goalAmount}>
        <Input name="goalAmount" inputMode="decimal" />
      </Field>
      <Field label="Quando quer ter conquistado" error={state.fieldErrors?.goalMonth}>
        <Input name="goalMonth" type="month" />
      </Field>
      <Field
        label="De onde sai"
        hint="A conta de onde o dinheiro sai todo mês."
        error={state.fieldErrors?.goalAccount}
      >
        <Select name="goalAccount" defaultValue={accounts[0]?.id ?? ""}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Footer pending={pending} label="Concluir" skipTo={null} />
    </form>
  );
}
