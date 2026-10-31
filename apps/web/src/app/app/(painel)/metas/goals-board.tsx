"use client";
import { Pause, Pencil, PiggyBank, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { formatBRL, formatYearMonth } from "@organizeup/domain";
import {
  Badge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  FormMessage,
  IconButton,
  Input,
  PageHeader,
  Select,
  Sheet,
  StatTile,
  submitKeeping,
} from "@/components/ui";
import type { loadGoals } from "@/lib/goals";
import { confirmEntry } from "../lancamentos/actions";
import {
  addSavedToGoal,
  deleteGoal,
  replanNow,
  saveGoal,
  setGoalStatus,
  type FormState,
} from "./actions";

type Data = Awaited<ReturnType<typeof loadGoals>>;
type Goal = Data["goals"][number];

const KIND_LABEL: Record<Goal["kind"], string> = {
  veiculo: "Carro ou moto",
  imovel: "Casa ou apartamento",
  reforma: "Reforma",
  educacao: "Estudos",
  compra: "Compra",
  evento: "Festa ou evento",
  outro: "Outro",
};

const PRIORITIES: Array<[number, string]> = [
  [1, "1 (mais urgente)"],
  [2, "2"],
  [3, "3"],
  [4, "4"],
  [5, "5 (menos urgente)"],
];

const initial: FormState = { ok: false, message: null };
const shortMonth = (month: string) => month.split("-").reverse().join("/");

function useClose(state: FormState, onDone: () => void) {
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
}

function GoalForm({ goal, data, onDone }: { goal: Goal | null; data: Data; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveGoal, initial);
  useClose(state, onDone);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={goal?.id ?? ""} />
      <Field label="Nome da meta">
        <Input
          name="name"
          required
          maxLength={80}
          placeholder="Ex.: Trocar de carro"
          defaultValue={goal?.name}
        />
      </Field>
      <Field label="Tipo">
        <Select name="kind" defaultValue={goal?.kind ?? "compra"}>
          {Object.entries(KIND_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Valor (R$)">
        <Input
          name="targetAmount"
          inputMode="decimal"
          required
          placeholder="0,00"
          defaultValue={goal?.targetAmount.replace(".", ",")}
        />
      </Field>
      <Field label="Quando quer ter conquistado" hint="Opcional.">
        <Input name="desiredMonth" type="month" defaultValue={goal?.desiredMonth ?? ""} />
      </Field>
      <Field label="Prioridade">
        <Select name="priority" defaultValue={goal?.priority ?? 3}>
          {PRIORITIES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Dia do mês para guardar">
        <Input
          name="planDay"
          type="number"
          min={1}
          max={28}
          required
          defaultValue={goal?.planDay ?? data.defaults.planDay}
        />
      </Field>
      <Field label="De onde sai">
        <Select name="accountId" defaultValue={goal?.accountId ?? data.defaults.accountId}>
          {data.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Onde o dinheiro fica"
        hint="Opcional. Se escolher uma conta, cada parcela vira uma saída e uma entrada nela."
      >
        <Select name="destinationAccountId" defaultValue={goal?.destinationAccountId ?? ""}>
          <option value="">Nenhuma conta</option>
          {data.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar meta"}
      </Button>
    </form>
  );
}

function SavedForm({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const [state, action, pending] = useActionState(addSavedToGoal, initial);
  useClose(state, onDone);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={goal.id} />
      <Field label="Quanto você separou (R$)" hint="Soma ao que já estava guardado.">
        <Input name="amount" inputMode="decimal" required placeholder="0,00" />
      </Field>
      <p className="text-xs text-muted">Isto não mexe nas suas contas. É só o controle da meta.</p>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Registrar valor"}
      </Button>
    </form>
  );
}

function GoalBadge({ goal }: { goal: Goal }) {
  if (goal.status === "concluida") return <Badge tone="success">Conquistada</Badge>;
  if (goal.status === "pausada") return <Badge>Pausada</Badge>;
  if (!goal.planned) return <Badge>Plano em preparo</Badge>;
  if (goal.planMonthly === null) return <Badge tone="warning">Sem espaço no orçamento</Badge>;
  return null;
}

function PlanText({ goal }: { goal: Goal }) {
  if (!goal.active) return null;
  if (!goal.planned)
    return (
      <p className="mt-2 text-sm text-muted">
        O assistente calcula o plano na próxima madrugada e encaixa as parcelas no calendário.
      </p>
    );
  const note = goal.planNote;
  if (goal.planMonthly === null)
    return (
      <>
        <p className="mt-2 text-sm">
          Hoje não sobra para esta meta. Reduza o valor, adie a data ou pause outra meta.
        </p>
        {note && !note.startsWith("Hoje não sobra") ? (
          <p className="mt-1 text-xs text-muted">{note}</p>
        ) : null}
      </>
    );
  return (
    <>
      {goal.planStart && goal.planEnd ? (
        <p className="mt-2 text-sm">
          Guarde <strong className="tabular-nums">{formatBRL(goal.planMonthly)}</strong> por mês de{" "}
          {formatYearMonth(goal.planStart)} a {formatYearMonth(goal.planEnd)}.
        </p>
      ) : null}
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
    </>
  );
}

function GoalCard({
  goal,
  writable,
  onEdit,
  onSaved,
  onRemove,
}: {
  goal: Goal;
  writable: boolean;
  onEdit: () => void;
  onSaved: () => void;
  onRemove: () => void;
}) {
  const paused = goal.status === "pausada";
  return (
    <Card
      title={goal.name}
      description={`${KIND_LABEL[goal.kind]}${
        goal.desiredMonth ? ` · para ${formatYearMonth(goal.desiredMonth)}` : ""
      }`}
      actions={
        writable ? (
          <div className="flex">
            <IconButton label={`Editar ${goal.name}`} onClick={onEdit}>
              <Pencil className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton label={`Excluir ${goal.name}`} onClick={onRemove}>
              <Trash2 className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        ) : null
      }
    >
      <GoalBadge goal={goal} />
      <div className="mt-2 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium tabular-nums">{formatBRL(goal.targetAmount)}</span>
        <span className="tabular-nums text-muted">{formatBRL(goal.saved)} guardados</span>
      </div>
      <div
        role="progressbar"
        aria-label={`Progresso de ${goal.name}`}
        aria-valuenow={goal.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-1.5 h-2 rounded-full bg-brand-50"
      >
        <div className="h-2 rounded-full bg-brand-500" style={{ width: `${goal.percent}%` }} />
      </div>
      <PlanText goal={goal} />

      {goal.overdue.length > 0 ? (
        <ul
          aria-label={`Parcelas vencidas de ${goal.name}`}
          className="m-0 mt-3 list-none divide-y divide-line p-0"
        >
          {goal.overdue.map((row) => (
            <li key={row.key} className="flex items-center gap-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 first-letter:uppercase">
                {formatYearMonth(row.month)}
                <span className="block font-medium tabular-nums">{formatBRL(row.amount)}</span>
              </span>
              {writable ? (
                <form action={confirmEntry}>
                  <input type="hidden" name="key" value={row.key} />
                  <input type="hidden" name="month" value={row.month} />
                  <Button
                    type="submit"
                    variant="secondary"
                    small
                    aria-label={`Confirmei a parcela de ${formatYearMonth(row.month)} de ${goal.name}`}
                  >
                    Confirmei
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {writable && goal.status !== "concluida" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            small
            aria-label={`Registrar valor guardado em ${goal.name}`}
            onClick={onSaved}
          >
            <PiggyBank className="size-4" aria-hidden="true" />
            Guardei
          </Button>
          <form action={setGoalStatus}>
            <input type="hidden" name="id" value={goal.id} />
            <input type="hidden" name="status" value={paused ? "planejando" : "pausada"} />
            <Button
              type="submit"
              variant="secondary"
              small
              aria-label={`${paused ? "Retomar" : "Pausar"} ${goal.name}`}
            >
              {paused ? (
                <Play className="size-4" aria-hidden="true" />
              ) : (
                <Pause className="size-4" aria-hidden="true" />
              )}
              {paused ? "Retomar" : "Pausar"}
            </Button>
          </form>
        </div>
      ) : null}
    </Card>
  );
}

function Replan() {
  const [state, action, pending] = useActionState(replanNow, initial);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <Button type="submit" variant="secondary" small disabled={pending}>
        <RefreshCw className="size-4" aria-hidden="true" />
        {pending ? "Recalculando…" : "Recalcular agora"}
      </Button>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
    </form>
  );
}

type Open = { type: "new" | "edit" | "saved"; nonce: number; id: string | null };

const TITLES: Record<Open["type"], string> = {
  new: "Nova meta",
  edit: "Editar meta",
  saved: "Valor guardado",
};

export function GoalsBoard({ data, writable }: { data: Data; writable: boolean }) {
  const [sheet, setSheet] = useState<Open | null>(null);
  const [removing, setRemoving] = useState<Goal | null>(null);
  const close = () => setSheet(null);
  const open = (type: Open["type"], id: string | null) =>
    setSheet((s) => ({ type, id, nonce: (s?.nonce ?? 0) + 1 }));
  const selected = data.goals.find((goal) => goal.id === sheet?.id) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Metas"
        title="Metas da família"
        description="Com o valor e a data, o assistente mostra quanto guardar por mês."
        actions={
          writable && data.goals.length > 0 ? (
            <Button variant="secondary" onClick={() => open("new", null)}>
              <Plus className="size-4" aria-hidden="true" />
              Nova meta
            </Button>
          ) : null
        }
      />

      {data.goals.length === 0 ? (
        <Card>
          <EmptyState
            title="Qual é o próximo sonho da família?"
            text="Diga quanto custa e quando quer. O assistente calcula quanto guardar por mês e encaixa no seu calendário."
            action={writable ? <Button onClick={() => open("new", null)}>Criar meta</Button> : null}
          />
        </Card>
      ) : (
        <>
          <dl className="m-0 grid grid-cols-2 gap-4">
            <StatTile
              label="Guardando por mês"
              value={formatBRL(data.nextMonthTotal)}
              hint={
                data.nextMonth
                  ? `Parcelas de ${formatYearMonth(data.nextMonth)}.`
                  : "Nenhuma parcela planejada."
              }
            />
            <StatTile
              label="Próxima conquista"
              value={data.nextGoal ? shortMonth(data.nextGoal.end) : "Nenhuma"}
              hint={data.nextGoal?.name}
            />
          </dl>
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
            {data.goals.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                writable={writable}
                onEdit={() => open("edit", goal.id)}
                onSaved={() => open("saved", goal.id)}
                onRemove={() => setRemoving(goal)}
              />
            ))}
          </div>
          {writable ? <Replan /> : null}
        </>
      )}

      <p className="text-xs text-muted">
        O plano é recalculado todo dia quando suas receitas e despesas mudam.
      </p>

      <Sheet open={sheet !== null} onClose={close} title={sheet ? TITLES[sheet.type] : ""}>
        {sheet?.type === "new" ? (
          <GoalForm key={sheet.nonce} goal={null} data={data} onDone={close} />
        ) : null}
        {sheet?.type === "edit" && selected ? (
          <GoalForm key={sheet.nonce} goal={selected} data={data} onDone={close} />
        ) : null}
        {sheet?.type === "saved" && selected ? (
          <SavedForm key={sheet.nonce} goal={selected} onDone={close} />
        ) : null}
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Excluir meta"
        text={`"${removing?.name ?? ""}" sai do plano e do calendário. O que já foi confirmado continua nos lançamentos.`}
        confirmLabel="Excluir"
        action={deleteGoal}
        hidden={{ id: removing?.id ?? "" }}
      />
    </div>
  );
}
