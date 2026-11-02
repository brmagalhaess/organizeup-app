"use client";
import { Pencil, PiggyBank, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { money, toDbAmount } from "@organizeup/domain";
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
import { formatDate, toFieldValue } from "@/i18n/format";
import type { loadTrips } from "@/lib/planning";
import type { TripSuggestions as TripSuggestionsData } from "@/lib/suggestions";
import { addCost, addSaved, deleteCost, deleteTrip, saveTrip, type FormState } from "./actions";
import { TripSuggestions } from "./trip-suggestions";
import { useMoney } from "@/i18n/money";

type Data = Awaited<ReturnType<typeof loadTrips>>;
type Trip = Data["trips"][number];
type Cost = Trip["costs"][number];

const COST_KINDS = [
  "passagem",
  "hospedagem",
  "alimentacao",
  "transporte",
  "passeios",
  "outros",
] as const;
type CostKind = (typeof COST_KINDS)[number];

const initial: FormState = { ok: false, message: null };

/** Valor do banco de volta ao campo, com os centavos: "1500.00" vira "1500,00" em português. */
function useClose(state: FormState, onDone: () => void) {
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
}

function TripForm({ trip, data, onDone }: { trip: Trip | null; data: Data; onDone: () => void }) {
  const t = useTranslations("viagens.form");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(saveTrip, initial);
  useClose(state, onDone);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={trip?.id ?? ""} />
      <Field label={t("destination")}>
        <Input
          name="destination"
          required
          maxLength={80}
          placeholder={t("destinationPlaceholder")}
          defaultValue={trip?.destination}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("start")}>
          <Input name="startOn" type="date" required defaultValue={trip?.startOn} />
        </Field>
        <Field label={t("end")}>
          <Input name="endOn" type="date" defaultValue={trip?.endOn ?? ""} />
        </Field>
      </div>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0 text-sm">
        <legend className="mb-1.5 font-medium">{t("who")}</legend>
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
        {pending ? tCommon("saving") : t("save")}
      </Button>
    </form>
  );
}

function CostForm({ trip, onDone }: { trip: Trip; onDone: () => void }) {
  const t = useTranslations("viagens");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(addCost, initial);
  useClose(state, onDone);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="tripId" value={trip.id} />
      <Field label={t("cost.kind")}>
        <Select name="kind" defaultValue="passagem">
          {COST_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`kinds.${kind}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("cost.amount")} hint={t("cost.amountHint")}>
        <Input
          name="amount"
          inputMode="decimal"
          required
          placeholder={t("cost.amountPlaceholder")}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="perPerson" className="size-5 accent-brand-500" />
        {t("cost.perPerson")}
      </label>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("cost.save")}
      </Button>
    </form>
  );
}

function SavedForm({ trip, onDone }: { trip: Trip; onDone: () => void }) {
  const t = useTranslations("viagens");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [state, action, pending] = useActionState(addSaved, initial);
  useClose(state, onDone);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={trip.id} />
      <Field label={t("saved.amount")} hint={t("saved.hint")}>
        <Input
          name="amount"
          inputMode="decimal"
          required
          placeholder={t("cost.amountPlaceholder")}
          defaultValue={
            trip.plan.monthly && money(trip.plan.monthly).gt(0)
              ? toFieldValue(trip.plan.monthly, locale)
              : ""
          }
        />
      </Field>
      <p className="text-xs text-muted">{t("saved.note")}</p>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("saved.save")}
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
  const t = useTranslations("viagens");
  const locale = useLocale();
  const moneyText = useMoney();
  const { plan } = trip;
  const name = trip.destination;
  const start = formatDate(trip.startOn, locale);
  const names = trip.names.join(", ");
  const strong = (chunks: ReactNode) => <strong className="tabular-nums">{chunks}</strong>;
  return (
    <Card
      title={name}
      description={
        trip.endOn
          ? t("card.dateRange", { start, end: formatDate(trip.endOn, locale), names })
          : t("card.date", { start, names })
      }
      actions={
        writable ? (
          <div className="flex">
            <IconButton label={t("card.edit", { name })} onClick={() => onOpen("edit")}>
              <Pencil className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton label={t("card.delete", { name })} onClick={onRemove}>
              <Trash2 className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        ) : null
      }
    >
      {plan.past ? <Badge>{t("card.past")}</Badge> : null}
      {money(plan.total).isZero() ? (
        <p className="text-sm text-muted">{t("card.noCosts")}</p>
      ) : (
        <div className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{moneyText(plan.total)}</span>
            <span className="tabular-nums text-muted">
              {t("card.saved", { amount: moneyText(trip.saved) })}
            </span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-brand-50" aria-hidden="true">
            <div className="h-2 rounded-full bg-brand-500" style={{ width: `${plan.percent}%` }} />
          </div>
          {plan.monthly !== null && money(plan.missing).gt(0) ? (
            <p className="mt-2">
              {plan.monthsLeft > 1
                ? t.rich("card.saveMonthly", {
                    amount: moneyText(plan.monthly),
                    months: plan.monthsLeft,
                    strong,
                  })
                : t.rich("card.saveUntilTrip", {
                    amount: moneyText(plan.monthly),
                    strong,
                  })}
            </p>
          ) : null}
          {money(plan.missing).isZero() ? <p className="mt-2">{t("card.covered")}</p> : null}
          {trip.personIds.length > 1 ? (
            <p className="mt-1 text-xs text-muted">
              {t("card.perTraveler", { amount: moneyText(plan.perTraveler) })}
            </p>
          ) : null}
        </div>
      )}

      {trip.costs.length > 0 ? (
        <ul
          aria-label={t("card.costs", { name })}
          className="m-0 mt-3 list-none divide-y divide-line p-0"
        >
          {trip.costs.map((cost) => {
            const kind = t(`kinds.${cost.kind as CostKind}`);
            return (
              <li key={cost.id} className="flex items-center gap-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1">
                  {cost.perPerson ? t("card.costPerPerson", { kind }) : kind}
                </span>
                <span className="whitespace-nowrap font-medium tabular-nums">
                  {moneyText(cost.amount)}
                </span>
                {writable ? (
                  <IconButton
                    label={t("card.deleteCost", { kind })}
                    onClick={() => onRemoveCost(cost)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </IconButton>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {writable ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            small
            aria-label={t("card.addCostAria", { name })}
            onClick={() => onOpen("cost")}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("card.addCost")}
          </Button>
          <Button
            variant="secondary"
            small
            aria-label={t("card.savedAria", { name })}
            onClick={() => onOpen("saved")}
          >
            <PiggyBank className="size-4" aria-hidden="true" />
            {t("card.savedButton")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

type Open = { type: "new" | "edit" | "cost" | "saved"; nonce: number; id: string | null };

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
  const t = useTranslations("viagens");
  const locale = useLocale();
  const moneyText = useMoney();
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
        eyebrow={t("header.eyebrow")}
        title={t("header.title")}
        description={t("header.description")}
        actions={
          writable ? (
            <Button variant="secondary" onClick={() => open("new", null)}>
              <Plus className="size-4" aria-hidden="true" />
              {t("header.newTrip")}
            </Button>
          ) : null
        }
      />
      {insights}

      {data.trips.length === 0 ? (
        <Card>
          <EmptyState
            title={t("empty.title")}
            text={t("empty.text")}
            action={
              writable ? (
                <Button variant="secondary" small onClick={() => open("new", null)}>
                  {t("empty.plan")}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-3">
            <StatTile
              label={t("stats.next")}
              value={upcoming[0]?.destination ?? t("stats.none")}
              hint={upcoming[0] ? formatDate(upcoming[0].startOn, locale) : undefined}
            />
            <StatTile
              label={t("stats.missing")}
              value={moneyText(sum(upcoming.map((trip) => trip.plan.missing)))}
            />
            <StatTile
              label={t("stats.monthly")}
              value={moneyText(sum(upcoming.map((trip) => trip.plan.monthly ?? "0")))}
              hint={t("stats.monthlyHint")}
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

      <Sheet open={sheet !== null} onClose={close} title={sheet ? t(`sheets.${sheet.type}`) : ""}>
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
        title={t("remove.title")}
        text={t("remove.text", { name: removing?.destination ?? "" })}
        confirmLabel={t("remove.confirm")}
        action={deleteTrip}
        hidden={{ id: removing?.id ?? "" }}
      />
      <ConfirmSheet
        open={removingCost !== null}
        onClose={() => setRemovingCost(null)}
        title={t("removeCost.title")}
        text={t("removeCost.text")}
        confirmLabel={t("removeCost.confirm")}
        action={deleteCost}
        hidden={{ id: removingCost?.id ?? "" }}
      />
    </div>
  );
}
