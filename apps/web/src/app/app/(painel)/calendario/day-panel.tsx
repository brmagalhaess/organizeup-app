"use client";
import { AlertCircle, CalendarPlus, Check, Clock, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { formatBRL, money, yearMonthOf, type CalendarItem } from "@organizeup/domain";
import { useEntryDialog } from "@/components/shell/entry-context";
import {
  amountClass,
  buttonClass,
  confirmLabel,
  cx,
  doneLabel,
  isGoalEntry,
} from "@/components/styles";
import {
  Badge,
  Button,
  Field,
  FormMessage,
  IconButton,
  Input,
  Sheet,
  submitKeeping,
} from "@/components/ui";
import type { loadCalendar } from "@/lib/calendar-data";
import { confirmEntry } from "../lancamentos/actions";
import { PlanLink } from "../lancamentos/plan-link";
import { deleteEvent, saveEvent, type EventFormState } from "./actions";
import { isOverdue, itemHref, TYPE_LABEL, typeOf, type CalendarFilter } from "./calendar-model";
import { TYPE_ICON, TYPE_TEXT } from "./item-types";

type Data = Awaited<ReturnType<typeof loadCalendar>>;

const initial: EventFormState = { ok: false, message: null };
const fullDayName = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

function ItemStatus({ item, today }: { item: CalendarItem; today: string }) {
  if (item.type === "compromisso") return item.yearly ? <Badge>Todo ano</Badge> : null;
  if (item.type === "fechamento") return <Badge>Fechamento</Badge>;
  if (item.status === "realizado")
    return (
      <Badge tone="success">
        <Check className="size-3" aria-hidden="true" />
        {doneLabel({ kind: item.kind, source: isGoalEntry(item.title) ? "meta" : item.source })}
      </Badge>
    );
  if (isOverdue(item, today))
    return (
      <Badge tone="danger">
        <AlertCircle className="size-3" aria-hidden="true" />
        Atrasado
      </Badge>
    );
  return (
    <Badge>
      <Clock className="size-3" aria-hidden="true" />
      Previsto
    </Badge>
  );
}

function DayItem({ item, data, writable }: { item: CalendarItem; data: Data; writable: boolean }) {
  const type = typeOf(item, data.types);
  const Icon = TYPE_ICON[type];
  const href = itemHref(item, type);
  const open = item.type === "lancamento" && item.status === "previsto";
  const removable = item.type === "compromisso";
  return (
    <li className="flex gap-3 py-3">
      <span
        aria-hidden="true"
        className={cx(
          "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50",
          TYPE_TEXT[type],
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="break-words text-sm font-medium">{item.title}</p>
        {item.type === "lancamento" ? (
          <p className={cx("text-sm font-semibold tabular-nums", amountClass(item.kind))}>
            {item.kind === "receita" ? "+ " : "− "}
            {formatBRL(item.amount)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{TYPE_LABEL[type]}</Badge>
          <ItemStatus item={item} today={data.today} />
          {item.type === "lancamento" && item.source === "meta" ? (
            <PlanLink description={item.title} />
          ) : null}
        </div>
        {(writable && (open || removable)) || href ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {writable && open ? (
              <form action={confirmEntry}>
                <input type="hidden" name="key" value={item.key} />
                <input type="hidden" name="month" value={yearMonthOf(item.date)} />
                <Button type="submit" small>
                  {confirmLabel(item)}
                </Button>
              </form>
            ) : null}
            {href ? (
              <Link
                href={href}
                aria-label={`Abrir ${item.title}`}
                className={buttonClass("secondary", true)}
              >
                Abrir
              </Link>
            ) : null}
            {writable && item.type === "compromisso" ? (
              <form action={deleteEvent}>
                <input type="hidden" name="id" value={item.id} />
                <IconButton type="submit" label={`Excluir ${item.title}`}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function EventForm({ date, onDone }: { date: string; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveEvent, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="date" value={date} />
      <Field label="Nome do evento">
        <Input name="title" required maxLength={120} placeholder="Ex.: Consulta no dentista" />
      </Field>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" name="yearly" className="size-5 accent-brand-500" />
        Repete todo ano, como um aniversário
      </label>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar evento"}
      </Button>
    </form>
  );
}

export function DayPanel({
  date,
  items,
  hidden,
  filter,
  data,
  writable,
}: {
  date: string;
  /** Itens do dia que passam pelo filtro. */
  items: CalendarItem[];
  /** Quantos itens do dia o filtro escondeu. */
  hidden: number;
  filter: CalendarFilter;
  data: Data;
  writable: boolean;
}) {
  const { openNew } = useEntryDialog();
  const [creating, setCreating] = useState<number | null>(null);
  const close = () => setCreating(null);
  const balance = data.balances[date];
  const negative = balance !== undefined && money(balance).lt(0);
  const label = fullDayName.format(new Date(`${date}T12:00:00Z`));
  const monthEmpty = Object.keys(data.items).length === 0;

  return (
    <section
      aria-label="Dia escolhido"
      className="min-w-0 rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6 xl:sticky xl:top-6"
    >
      <div aria-live="polite">
        <h2 className="font-display text-xl font-medium first-letter:uppercase">{label}</h2>
        {date === data.today ? <p className="text-sm text-muted">Hoje</p> : null}
      </div>
      {balance ? (
        <p className="mt-3 rounded-xl bg-card-soft p-3 text-sm">
          <span className="text-muted">Saldo previsto no fim do dia: </span>
          <span className={cx("font-semibold tabular-nums", negative && "text-danger")}>
            {formatBRL(balance)}
          </span>
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {hidden > 0
            ? `Nada deste tipo neste dia. ${hidden === 1 ? "1 item está escondido" : `${hidden} itens estão escondidos`} pelo filtro.`
            : monthEmpty
              ? "Nada marcado neste mês. Escolha um dia para lançar uma conta ou marcar um evento."
              : "Nada marcado neste dia."}
        </p>
      ) : (
        <>
          <ul aria-label="Itens do dia" className="m-0 mt-2 list-none divide-y divide-line p-0">
            {items.map((item) => (
              <DayItem key={item.key} item={item} data={data} writable={writable} />
            ))}
          </ul>
          {hidden > 0 && filter !== "todos" ? (
            <p className="mt-1 text-xs text-muted">
              {hidden === 1 ? "Mais 1 item" : `Mais ${hidden} itens`} fora deste filtro.
            </p>
          ) : null}
        </>
      )}

      {writable ? (
        <div className="mt-4 grid grid-cols-1 gap-2 border-t border-line pt-4 sm:grid-cols-2 xl:grid-cols-1">
          <Button variant="secondary" onClick={() => openNew("despesa", undefined, date)}>
            <Plus className="size-4" aria-hidden="true" />
            Lançar neste dia
          </Button>
          <Button variant="secondary" onClick={() => setCreating((nonce) => (nonce ?? 0) + 1)}>
            <CalendarPlus className="size-4" aria-hidden="true" />
            Marcar evento
          </Button>
        </div>
      ) : null}

      <Sheet open={creating !== null} onClose={close} title="Novo evento">
        <p className="mb-4 text-sm text-muted first-letter:uppercase">{label}</p>
        <EventForm key={creating} date={date} onDone={close} />
      </Sheet>
    </section>
  );
}
