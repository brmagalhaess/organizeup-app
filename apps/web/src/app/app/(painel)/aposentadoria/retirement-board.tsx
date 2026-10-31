"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { formatBRL, money } from "@organizeup/domain";
import {
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  FormMessage,
  IconButton,
  Input,
  Select,
  Sheet,
  submitKeeping,
} from "@/components/ui";
import type { loadRetirement } from "@/lib/planning";
import { deleteScenario, saveScenario, type FormState } from "./actions";
import { RetirementChart } from "./retirement-chart";

type Data = Awaited<ReturnType<typeof loadRetirement>>;
type Scenario = Data["scenarios"][number];

const initial: FormState = { ok: false, message: null };
const comma = (value: string | null | undefined) => value?.replace(".", ",") ?? "";

function ScenarioForm({
  scenario,
  data,
  onDone,
}: {
  scenario: Scenario | null;
  data: Data;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(saveScenario, initial);
  const [personId, setPersonId] = useState(scenario?.personId ?? data.people[0]?.id ?? "");
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  const person = data.people.find((row) => row.id === personId);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={scenario?.id ?? ""} />
      <Field label="Nome do cenário">
        <Input
          name="name"
          required
          maxLength={60}
          placeholder="Ex.: Parar aos 60"
          defaultValue={scenario?.name}
        />
      </Field>
      <Field label="Para quem">
        <Select
          name="personId"
          value={personId}
          onChange={(event) => setPersonId(event.target.value)}
        >
          {data.people.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </Select>
      </Field>
      {person && !person.hasBirth ? (
        <Field
          label="Mês e ano de nascimento"
          hint="Precisamos disso para saber quanto tempo falta."
        >
          <Input name="birth" type="month" required />
        </Field>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Parar aos">
          <Input
            name="targetAge"
            inputMode="numeric"
            required
            defaultValue={scenario?.targetAge ?? 65}
          />
        </Field>
        <Field label="Planejar até os" hint="Até que idade o dinheiro deve durar.">
          <Input
            name="lifeExpectancy"
            inputMode="numeric"
            required
            defaultValue={scenario?.lifeExpectancy ?? 90}
          />
        </Field>
      </div>
      <Field label="Renda desejada por mês (R$)" hint="Em dinheiro de hoje.">
        <Input
          name="targetIncome"
          inputMode="decimal"
          required
          placeholder="8.000,00"
          defaultValue={comma(scenario?.targetIncome)}
        />
      </Field>
      <Field
        label="INSS e outras rendas por mês (R$)"
        hint="Veja a estimativa do INSS no site ou app Meu INSS."
      >
        <Input
          name="otherIncome"
          inputMode="decimal"
          placeholder="0,00"
          defaultValue={comma(scenario?.otherIncome)}
        />
      </Field>
      <Field
        label="Já guardado (R$)"
        hint={`Vazio usa a sua carteira de investimentos: ${formatBRL(data.portfolio)}.`}
      >
        <Input
          name="saved"
          inputMode="decimal"
          placeholder="Usar a carteira"
          defaultValue={comma(scenario?.saved)}
        />
      </Field>
      <Field label="Quanto você guarda por mês (R$)">
        <Input
          name="monthlyContribution"
          inputMode="decimal"
          placeholder="0,00"
          defaultValue={comma(scenario?.monthlyContribution)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Retorno até parar (%)" hint="Ao ano, acima da inflação.">
          <Input
            name="returnBefore"
            inputMode="decimal"
            required
            defaultValue={comma(scenario?.returnBefore) || "4,00"}
          />
        </Field>
        <Field label="Retorno depois (%)" hint="Ao ano, acima da inflação.">
          <Input
            name="returnAfter"
            inputMode="decimal"
            required
            defaultValue={comma(scenario?.returnAfter) || "2,00"}
          />
        </Field>
      </div>
      <p className="text-xs text-muted">
        Os retornos são só um ponto de partida para você ajustar. Ninguém garante esses números.
      </p>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar cenário"}
      </Button>
    </form>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="m-0 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function ScenarioCard({
  scenario,
  writable,
  onEdit,
  onRemove,
}: {
  scenario: Scenario;
  writable: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { result } = scenario;
  const required = result.requiredContribution;
  const extra = required === null ? null : money(required).minus(scenario.monthlyContribution);
  return (
    <Card
      title={scenario.name}
      description={`${scenario.personName}, ${scenario.age} anos. Parar aos ${scenario.targetAge}.`}
      actions={
        writable ? (
          <div className="flex">
            <IconButton label={`Editar ${scenario.name}`} onClick={onEdit}>
              <Pencil className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton label={`Excluir ${scenario.name}`} onClick={onRemove}>
              <Trash2 className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        ) : null
      }
    >
      <div className="text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium">
            {result.percent >= 100 ? "O plano fecha" : `${result.percent}% do necessário`}
          </span>
          <span className="tabular-nums text-muted">
            {formatBRL(result.projected)} de {formatBRL(result.needed)}
          </span>
        </div>
        <div className="mt-1.5 h-2 rounded-full bg-brand-50" aria-hidden="true">
          <div className="h-2 rounded-full bg-brand-500" style={{ width: `${result.percent}%` }} />
        </div>
      </div>

      <dl className="m-0 mt-4 grid grid-cols-1 gap-3 rounded-xl bg-card-soft p-4 text-sm sm:grid-cols-3">
        <Fact
          label="Aporte que fecha a conta"
          value={required === null ? "Já parou" : `${formatBRL(required)} por mês`}
        />
        <Fact
          label="Renda que o plano sustenta"
          value={`${formatBRL(result.sustainableIncome)} por mês`}
        />
        <Fact
          label="O dinheiro dura"
          value={
            result.runsOutAtAge === null
              ? `Até os ${scenario.lifeExpectancy} anos`
              : `Até os ${result.runsOutAtAge} anos`
          }
        />
      </dl>
      {extra !== null && extra.gt(0) ? (
        <p className="mt-3 text-sm">
          Para chegar lá, faltam {formatBRL(extra)} por mês além do que você guarda hoje, ou ajuste
          a idade e a renda desejada.
        </p>
      ) : null}

      <div className="mt-4">
        <RetirementChart points={result.series} targetAge={scenario.targetAge} />
      </div>
      <p className="mt-3 text-xs text-muted">
        Premissas: retorno de {comma(scenario.returnBefore)}% até parar e{" "}
        {comma(scenario.returnAfter)}% depois, ao ano acima da inflação. Sem impostos.
      </p>
    </Card>
  );
}

export function RetirementBoard({
  data,
  writable,
  startOpen,
}: {
  data: Data;
  writable: boolean;
  /** Sem plano de rendimentos válido, ou com cenários já criados, a comparação começa aberta. */
  startOpen: boolean;
}) {
  const [editing, setEditing] = useState<{ nonce: number; scenario: Scenario | null } | null>(null);
  const [removing, setRemoving] = useState<Scenario | null>(null);
  const [expanded, setExpanded] = useState(startOpen);
  const close = () => setEditing(null);
  const open = (scenario: Scenario | null) =>
    setEditing((s) => ({ nonce: (s?.nonce ?? 0) + 1, scenario }));
  const untilAge = data.scenarios[0]?.lifeExpectancy ?? 90;

  return (
    <div>
      <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary className="cursor-pointer rounded-2xl border border-line bg-card p-4 shadow-card sm:px-6">
          <span className="font-semibold">Comparar: gastar o que guardou</span>
          <span className="mt-0.5 block text-sm text-muted">
            Outro jeito de ver: o dinheiro vai sendo usado até os {untilAge} anos. Só comparação.
          </span>
        </summary>

        <div className="mt-4 flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">Compare cenários mudando idade, renda e aporte.</p>
            {writable ? (
              <Button variant="secondary" onClick={() => open(null)}>
                <Plus className="size-4" aria-hidden="true" />
                Novo cenário
              </Button>
            ) : null}
          </div>

          {data.scenarios.length === 0 ? (
            <Card>
              <EmptyState
                title="Monte o primeiro cenário"
                text="Diga com que idade quer parar e quanto quer receber. Mostramos quanto guardar por mês."
                action={
                  writable ? (
                    <Button variant="secondary" small onClick={() => open(null)}>
                      Criar cenário
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
              {data.scenarios.map((scenario) => (
                <ScenarioCard
                  key={scenario.id}
                  scenario={scenario}
                  writable={writable}
                  onEdit={() => open(scenario)}
                  onRemove={() => setRemoving(scenario)}
                />
              ))}
            </div>
          )}

          <p className="text-xs text-muted">
            Estimativa feita com os dados e premissas que você informou. Não é promessa de resultado
            nem recomendação de investimento.
          </p>
        </div>
      </details>

      <Sheet
        open={editing !== null}
        onClose={close}
        title={editing?.scenario ? "Editar cenário" : "Novo cenário"}
      >
        <ScenarioForm
          key={editing?.nonce}
          scenario={editing?.scenario ?? null}
          data={data}
          onDone={close}
        />
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Excluir cenário"
        text={`"${removing?.name ?? ""}" será apagado.`}
        confirmLabel="Excluir"
        action={deleteScenario}
        hidden={{ id: removing?.id ?? "" }}
      />
    </div>
  );
}
