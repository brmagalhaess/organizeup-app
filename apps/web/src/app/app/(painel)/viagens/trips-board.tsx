"use client";
import { Pencil, PiggyBank, Plus, Trash2 } from "lucide-react";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { formatBRL, money, toDbAmount } from "@organizeup/domain";
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
import type { loadTrips } from "@/lib/planning";
import type { TripSuggestions as TripSuggestionsData } from "@/lib/suggestions";
import { addCost, addSaved, deleteCost, deleteTrip, saveTrip, type FormState } from "./actions";
import { TripSuggestions } from "./trip-suggestions";

type Data = Awaited<ReturnType<typeof loadTrips>>;
type Trip = Data["trips"][number];
type Cost = Trip["costs"][number];

const KIND_LABEL: Record<string, string> = {
  passagem: "Passagens",
  hospedagem: "Hospedagem",
  alimentacao: "Alimentação",
  transporte: "Transporte",
  passeios: "Passeios",
  outros: "Outros",
};

const initial: FormState = { ok: false, message: null };
const fullDate = (date: string) => date.split("-").reverse().join("/");

function useClose(state: FormState, onDone: () => void) {
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
}

function TripForm({ trip, data, onDone }: { trip: Trip | null; data: Data; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveTrip, initial);
  useClose(state, onDone);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={trip?.id ?? ""} />
      <Field label="Destino">
        <Input
          name="destination"
          required
          maxLength={80}
          placeholder="Ex.: Gramado"
          defaultValue={trip?.destination}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ida">
          <Input name="startOn" type="date" required defaultValue={trip?.startOn} />
        </Field>
        <Field label="Volta">
          <Input name="endOn" type="date" defaultValue={trip?.endOn ?? ""} />
        </Field>
      </div>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0 text-sm">
        <legend className="mb-1.5 font-medium">Quem vai</legend>
        {data.people.map((person) => (
          <label key={person.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              name="personId"
              value={person.id}
              defaultChecked={trip ? trip.personIds.includes(person.id) : true}
              className="size-5 accent-brand-500"
            />
            {person.name}
          </label>
        ))}
      </fieldset>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar viagem"}
      </Button>
    </form>
  );
}

function CostForm({ trip, onDone }: { trip: Trip; onDone: () => void }) {
  const [state, action, pending] = useActionState(addCost, initial);
  useClose(state, onDone);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="tripId" value={trip.id} />
      <Field label="Tipo">
        <Select name="kind" defaultValue="passagem">
          {Object.entries(KIND_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Valor (R$)" hint="Uma estimativa já ajuda. Você ajusta depois.">
        <Input name="amount" inputMode="decimal" required placeholder="0,00" />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="perPerson" className="size-5 accent-brand-500" />
        Este valor é por pessoa
      </label>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar custo"}
      </Button>
    </form>
  );
}

function SavedForm({ trip, onDone }: { trip: Trip; onDone: () => void }) {
  const [state, action, pending] = useActionState(addSaved, initial);
  useClose(state, onDone);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={trip.id} />
      <Field label="Quanto você separou (R$)" hint="Soma ao que já estava guardado.">
        <Input
          name="amount"
          inputMode="decimal"
          required
          placeholder="0,00"
          defaultValue={
            trip.plan.monthly && money(trip.plan.monthly).gt(0)
              ? trip.plan.monthly.replace(".", ",")
              : ""
          }
        />
      </Field>
      <p className="text-xs text-muted">
        Isto não mexe nas suas contas. É só o controle da viagem.
      </p>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Registrar valor"}
      </Button>
    </form>
  );
}

function TripCard({
  trip,
  writable,
  onOpen,
  onRemove,
  onRemoveCost,
}: {
  trip: Trip;
  writable: boolean;
  onOpen: (type: "edit" | "cost" | "saved") => void;
  onRemove: () => void;
  onRemoveCost: (cost: Cost) => void;
}) {
  const { plan } = trip;
  return (
    <Card
      title={trip.destination}
      description={`${fullDate(trip.startOn)}${trip.endOn ? ` a ${fullDate(trip.endOn)}` : ""} · ${trip.names.join(", ")}`}
      actions={
        writable ? (
          <div className="flex">
            <IconButton label={`Editar ${trip.destination}`} onClick={() => onOpen("edit")}>
              <Pencil className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton label={`Excluir ${trip.destination}`} onClick={onRemove}>
              <Trash2 className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        ) : null
      }
    >
      {plan.past ? <Badge>Já aconteceu</Badge> : null}
      {money(plan.total).isZero() ? (
        <p className="text-sm text-muted">Adicione os custos para ver quanto guardar por mês.</p>
      ) : (
        <div className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{formatBRL(plan.total)}</span>
            <span className="tabular-nums text-muted">{formatBRL(trip.saved)} guardados</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-brand-50" aria-hidden="true">
            <div className="h-2 rounded-full bg-brand-500" style={{ width: `${plan.percent}%` }} />
          </div>
          {plan.monthly !== null && money(plan.missing).gt(0) ? (
            <p className="mt-2">
              Guarde <strong className="tabular-nums">{formatBRL(plan.monthly)}</strong>{" "}
              {plan.monthsLeft > 1 ? `por mês, por ${plan.monthsLeft} meses` : "até a viagem"}.
            </p>
          ) : null}
          {money(plan.missing).isZero() ? <p className="mt-2">Viagem já coberta.</p> : null}
          {trip.personIds.length > 1 ? (
            <p className="mt-1 text-xs text-muted">{formatBRL(plan.perTraveler)} por pessoa.</p>
          ) : null}
        </div>
      )}

      {trip.costs.length > 0 ? (
        <ul
          aria-label={`Custos de ${trip.destination}`}
          className="m-0 mt-3 list-none divide-y divide-line p-0"
        >
          {trip.costs.map((cost) => (
            <li key={cost.id} className="flex items-center gap-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1">
                {KIND_LABEL[cost.kind]}
                {cost.perPerson ? " (por pessoa)" : ""}
              </span>
              <span className="whitespace-nowrap font-medium tabular-nums">
                {formatBRL(cost.amount)}
              </span>
              {writable ? (
                <IconButton
                  label={`Excluir custo de ${KIND_LABEL[cost.kind]}`}
                  onClick={() => onRemoveCost(cost)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {writable ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            small
            aria-label={`Adicionar custo em ${trip.destination}`}
            onClick={() => onOpen("cost")}
          >
            <Plus className="size-4" aria-hidden="true" />
            Custo
          </Button>
          <Button
            variant="secondary"
            small
            aria-label={`Registrar valor guardado em ${trip.destination}`}
            onClick={() => onOpen("saved")}
          >
            <PiggyBank className="size-4" aria-hidden="true" />
            Guardei
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

type Open = { type: "new" | "edit" | "cost" | "saved"; nonce: number; id: string | null };

const TITLES: Record<Open["type"], string> = {
  new: "Nova viagem",
  edit: "Editar viagem",
  cost: "Novo custo",
  saved: "Valor guardado",
};

export function TripsBoard({
  data,
  suggestions,
  writable,
  insights,
}: {
  data: Data;
  suggestions: TripSuggestionsData | null;
  writable: boolean;
  insights: ReactNode;
}) {
  const [sheet, setSheet] = useState<Open | null>(null);
  const [removing, setRemoving] = useState<Trip | null>(null);
  const [removingCost, setRemovingCost] = useState<Cost | null>(null);
  const close = () => setSheet(null);
  const open = (type: Open["type"], id: string | null) =>
    setSheet((s) => ({ type, id, nonce: (s?.nonce ?? 0) + 1 }));
  const selected = data.trips.find((trip) => trip.id === sheet?.id) ?? null;
  const upcoming = data.trips.filter((trip) => !trip.plan.past);
  const sum = (values: string[]) =>
    toDbAmount(values.reduce((acc, value) => acc.plus(value), money(0)));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Viagens"
        title="Viagens da família"
        description="Com o custo e a data, mostramos quanto guardar por mês."
        actions={
          writable ? (
            <Button variant="secondary" onClick={() => open("new", null)}>
              <Plus className="size-4" aria-hidden="true" />
              Nova viagem
            </Button>
          ) : null
        }
      />
      {insights}

      {data.trips.length === 0 ? (
        <Card>
          <EmptyState
            title="Qual é a próxima viagem?"
            text="Cadastre o destino e a data. A viagem entra no calendário, e você acompanha quanto falta."
            action={
              writable ? (
                <Button variant="secondary" small onClick={() => open("new", null)}>
                  Planejar viagem
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-3">
            <StatTile
              label="Próxima"
              value={upcoming[0]?.destination ?? "Nenhuma"}
              hint={upcoming[0] ? fullDate(upcoming[0].startOn) : undefined}
            />
            <StatTile
              label="Falta guardar"
              value={formatBRL(sum(upcoming.map((trip) => trip.plan.missing)))}
            />
            <StatTile
              label="Guardar por mês"
              value={formatBRL(sum(upcoming.map((trip) => trip.plan.monthly ?? "0")))}
              hint="Somando as próximas viagens."
            />
          </dl>
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
            {data.trips.map((trip) => (
              <TripCard
                key={trip.id}
                trip={trip}
                writable={writable}
                onOpen={(type) => open(type, trip.id)}
                onRemove={() => setRemoving(trip)}
                onRemoveCost={setRemovingCost}
              />
            ))}
          </div>
        </>
      )}

      {suggestions ? <TripSuggestions data={suggestions} writable={writable} /> : null}

      <Sheet open={sheet !== null} onClose={close} title={sheet ? TITLES[sheet.type] : ""}>
        {sheet?.type === "new" ? (
          <TripForm key={sheet.nonce} trip={null} data={data} onDone={close} />
        ) : null}
        {sheet?.type === "edit" && selected ? (
          <TripForm key={sheet.nonce} trip={selected} data={data} onDone={close} />
        ) : null}
        {sheet?.type === "cost" && selected ? (
          <CostForm key={sheet.nonce} trip={selected} onDone={close} />
        ) : null}
        {sheet?.type === "saved" && selected ? (
          <SavedForm key={sheet.nonce} trip={selected} onDone={close} />
        ) : null}
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Excluir viagem"
        text={`"${removing?.destination ?? ""}" sai do plano e do calendário.`}
        confirmLabel="Excluir"
        action={deleteTrip}
        hidden={{ id: removing?.id ?? "" }}
      />
      <ConfirmSheet
        open={removingCost !== null}
        onClose={() => setRemovingCost(null)}
        title="Excluir custo"
        text="O total da viagem será recalculado."
        confirmLabel="Excluir"
        action={deleteCost}
        hidden={{ id: removingCost?.id ?? "" }}
      />
    </div>
  );
}
