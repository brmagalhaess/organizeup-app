"use client";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  addMonths,
  formatBRL,
  formatBRLShort,
  formatShortDate,
  formatYearMonth,
  money,
  yearMonthOf,
  type CalendarItem,
} from "@organizeup/domain";
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
  Card,
  EmptyState,
  Field,
  FormMessage,
  IconButton,
  Input,
  PageHeader,
  Sheet,
  StatTile,
} from "@/components/ui";
import type { loadCalendar } from "@/lib/calendar-data";
import { confirmEntry } from "../lancamentos/actions";
import { PlanLink } from "../lancamentos/plan-link";
import { deleteEvent, saveEvent, type EventFormState } from "./actions";

type Data = Awaited<ReturnType<typeof loadCalendar>>;

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MAX_CHIPS = 3;
const initial: EventFormState = { ok: false, message: null };

const dateFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("pt-BR", { ...options, timeZone: "UTC" });
const dayName = dateFormat({ day: "numeric", month: "long" });
const fullDayName = dateFormat({ weekday: "long", day: "numeric", month: "long" });
const asDate = (date: string) => new Date(`${date}T12:00:00Z`);

/** Cor por tipo. O texto do item e a legenda dizem o mesmo, para não depender só da cor. */
function markerClass(item: CalendarItem) {
  if (item.type === "compromisso") return "bg-brand-500";
  if (item.type === "fechamento") return "bg-muted";
  return item.kind === "receita" ? "bg-income" : "bg-expense";
}

function isOverdue(item: CalendarItem, today: string) {
  return item.type === "lancamento" && item.status === "previsto" && item.date < today;
}

function Chip({ item, today }: { item: CalendarItem; today: string }) {
  const paid = item.type === "lancamento" && item.status === "realizado";
  return (
    <span className="flex min-w-0 items-center gap-1 text-[11px] leading-4">
      {isOverdue(item, today) ? (
        <AlertCircle className="size-3 shrink-0 text-danger" aria-hidden="true" />
      ) : paid ? (
        <Check className="size-3 shrink-0 text-muted" aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className={cx("size-2 shrink-0 rounded-sm", markerClass(item))} />
      )}
      <span className={cx("truncate", paid && "text-muted")}>{item.title}</span>
    </span>
  );
}

function ItemStatus({ item, today }: { item: CalendarItem; today: string }) {
  if (item.type === "compromisso") return <Badge>{item.yearly ? "Todo ano" : "Compromisso"}</Badge>;
  if (item.type === "fechamento") return <Badge>Fechamento</Badge>;
  if (item.status === "realizado")
    return (
      <Badge tone="success">
        <Check className="size-3" aria-hidden="true" />
        {doneLabel({ kind: item.kind, source: isGoalEntry(item.title) ? "meta" : item.source })}
      </Badge>
    );
  if (item.date < today)
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

function DayItem({
  item,
  today,
  writable,
}: {
  item: CalendarItem;
  today: string;
  writable: boolean;
}) {
  const open = item.type === "lancamento" && item.status === "previsto";
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{item.title}</p>
        {item.type === "lancamento" ? (
          <p className={cx("text-xs font-medium tabular-nums", amountClass(item.kind))}>
            {item.kind === "receita" ? "+ " : "− "}
            {formatBRL(item.amount)}
          </p>
        ) : null}
        <div className="mt-1 flex items-center gap-2">
          <ItemStatus item={item} today={today} />
          {item.type === "lancamento" && item.source === "meta" ? (
            <PlanLink description={item.title} />
          ) : null}
        </div>
      </div>
      {writable && open ? (
        <form action={confirmEntry}>
          <input type="hidden" name="key" value={item.key} />
          <input type="hidden" name="month" value={yearMonthOf(item.date)} />
          <Button type="submit" variant="secondary" small>
            {confirmLabel(item)}
          </Button>
        </form>
      ) : null}
      {writable && item.type === "compromisso" ? (
        <form action={deleteEvent}>
          <input type="hidden" name="id" value={item.id} />
          <IconButton type="submit" label={`Excluir ${item.title}`}>
            <Trash2 className="size-4" aria-hidden="true" />
          </IconButton>
        </form>
      ) : null}
    </li>
  );
}

function EventForm({ date }: { date: string }) {
  const [state, action, pending] = useActionState(saveEvent, initial);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="flex flex-col gap-3">
      <input type="hidden" name="date" value={date} />
      <Field label="Novo compromisso">
        <Input name="title" required maxLength={120} placeholder="Ex.: Consulta no dentista" />
      </Field>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" name="yearly" className="size-5 accent-brand-500" />
        Repete todo ano, como um aniversário
      </label>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Salvando…" : "Salvar compromisso"}
      </Button>
    </form>
  );
}

function DaySheet({
  date,
  data,
  writable,
  onClose,
}: {
  date: string | null;
  data: Data;
  writable: boolean;
  onClose: () => void;
}) {
  const { openNew } = useEntryDialog();
  const items = date ? (data.items[date] ?? []) : [];
  const balance = date ? data.balances[date] : undefined;
  return (
    <Sheet
      open={date !== null}
      onClose={onClose}
      title={date ? fullDayName.format(asDate(date)) : "Dia"}
    >
      {date ? (
        <div className="flex flex-col gap-5">
          {balance ? (
            <p className="rounded-xl bg-card-soft p-3 text-sm">
              <span className="text-muted">Saldo previsto no fim do dia: </span>
              <span className="font-semibold tabular-nums">{formatBRL(balance)}</span>
            </p>
          ) : null}
          {items.length === 0 ? (
            <p className="text-sm text-muted">Nada marcado neste dia.</p>
          ) : (
            <ul aria-label="Itens do dia" className="m-0 list-none divide-y divide-line p-0">
              {items.map((item) => (
                <DayItem key={item.key} item={item} today={data.today} writable={writable} />
              ))}
            </ul>
          )}
          {writable ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  onClose();
                  openNew("despesa", undefined, date);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                Lançar neste dia
              </Button>
              <div className="border-t border-line pt-4">
                <EventForm key={date} date={date} />
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

function DayCell({
  date,
  data,
  onOpen,
}: {
  date: string;
  data: Data;
  onOpen: (date: string) => void;
}) {
  const items = data.items[date] ?? [];
  const balance = data.balances[date];
  const negative = balance !== undefined && money(balance).lt(0);
  const isToday = date === data.today;
  const extra = items.length - MAX_CHIPS;
  const count = items.length === 1 ? "1 item" : `${items.length} itens`;

  return (
    <button
      type="button"
      onClick={() => onOpen(date)}
      aria-label={`${dayName.format(asDate(date))}${isToday ? ", hoje" : ""}, ${count}${
        balance ? `, saldo previsto ${formatBRL(balance)}` : ""
      }`}
      className={cx(
        "flex h-full min-h-14 w-full min-w-0 flex-col gap-1 rounded-lg p-1.5 text-left transition hover:bg-brand-50 md:min-h-28",
        isToday && "bg-card-soft ring-1 ring-brand-500",
      )}
    >
      <span
        className={cx(
          "flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
          isToday && "bg-brand-900 text-white",
        )}
      >
        {Number(date.slice(8, 10))}
      </span>
      <span aria-hidden="true" className="flex flex-wrap gap-0.5 md:hidden">
        {items.slice(0, 6).map((item) => (
          <span key={item.key} className={cx("size-1.5 rounded-full", markerClass(item))} />
        ))}
      </span>
      <span aria-hidden="true" className="hidden min-w-0 flex-1 flex-col gap-0.5 md:flex">
        {items.slice(0, MAX_CHIPS).map((item) => (
          <Chip key={item.key} item={item} today={data.today} />
        ))}
        {extra > 0 ? <span className="text-[11px] text-muted">+{extra}</span> : null}
      </span>
      {balance ? (
        <span
          aria-hidden="true"
          className={cx(
            "mt-auto hidden items-center gap-0.5 text-[11px] tabular-nums md:flex",
            negative ? "font-semibold text-danger" : "text-muted",
          )}
        >
          {negative ? <AlertTriangle className="size-3" /> : null}
          {formatBRLShort(balance)}
        </span>
      ) : null}
    </button>
  );
}

export function CalendarBoard({ data, writable }: { data: Data; writable: boolean }) {
  const [openDay, setOpenDay] = useState<string | null>(null);
  const { month, cells, summary, lowest, closing } = data;
  const goesNegative = lowest !== null && money(lowest.balance).lt(0);
  const monthLink = (target: string) => `/app/calendario?m=${target}`;
  const agenda = cells.days.filter((day) => (data.items[day] ?? []).length > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Calendário"
        title={formatYearMonth(month)}
        description="Vencimentos, compromissos e quanto deve sobrar a cada dia."
        actions={
          <>
            {month !== data.current ? (
              <Link href="/app/calendario" className={buttonClass("secondary")}>
                Hoje
              </Link>
            ) : null}
            <Link
              href={monthLink(addMonths(month, -1))}
              aria-label="Mês anterior"
              className={buttonClass("secondary")}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href={monthLink(addMonths(month, 1))}
              aria-label="Próximo mês"
              className={buttonClass("secondary")}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          </>
        }
      />

      {goesNegative ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl bg-warning-soft p-3 text-sm text-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Pelo que está previsto, seu saldo fica negativo. O menor valor é{" "}
            <span className="font-semibold">{formatBRL(lowest.balance)}</span>, em{" "}
            {formatShortDate(lowest.date)}.
          </p>
        </div>
      ) : null}

      <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile label="A receber" value={formatBRL(summary.plannedIncome)} />
        <StatTile label="A pagar" value={formatBRL(summary.plannedExpense)} />
        {lowest ? (
          <>
            <StatTile
              label="Menor saldo previsto"
              value={formatBRL(lowest.balance)}
              hint={`Em ${formatShortDate(lowest.date)}.`}
            />
            <StatTile
              label="Saldo no fim do mês"
              value={formatBRL(closing ?? "0")}
              hint="Saldo das contas mais o que está em aberto."
            />
          </>
        ) : (
          <>
            <StatTile label="Entrou" tone="receita" value={formatBRL(summary.received)} />
            <StatTile label="Saiu" tone="despesa" value={formatBRL(summary.spent)} />
          </>
        )}
      </dl>

      <Card>
        <div
          aria-hidden="true"
          className="grid grid-cols-7 gap-1 pb-1 text-center text-xs font-medium text-muted"
        >
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <ol aria-label="Dias do mês" className="m-0 grid list-none grid-cols-7 gap-1 p-0">
          {Array.from({ length: cells.leading }, (_, index) => (
            <li key={`vazio-${index}`} aria-hidden="true" />
          ))}
          {cells.days.map((date) => (
            <li key={date} className="min-w-0 rounded-lg border border-line">
              <DayCell date={date} data={data} onOpen={setOpenDay} />
            </li>
          ))}
        </ol>
        <ul className="m-0 mt-4 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-muted">
          {[
            ["bg-income", "Entradas"],
            ["bg-expense", "Saídas"],
            ["bg-brand-500", "Compromissos"],
            ["bg-muted", "Fechamento de fatura"],
          ].map(([color, label]) => (
            <li key={label} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={cx("size-2.5 rounded-sm", color)} />
              {label}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Agenda do mês" className="md:hidden">
        {agenda.length === 0 ? (
          <EmptyState
            title="Nada neste mês"
            text="Toque em um dia para marcar um compromisso ou lançar uma conta."
          />
        ) : (
          <ul aria-label="Agenda do mês" className="m-0 list-none divide-y divide-line p-0">
            {agenda.map((day) => (
              <li key={day}>
                <button
                  type="button"
                  onClick={() => setOpenDay(day)}
                  className="flex w-full gap-3 py-2.5 text-left"
                >
                  <span className="w-12 shrink-0 text-sm tabular-nums text-muted">
                    {formatShortDate(day)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    {(data.items[day] ?? []).map((item) => (
                      <Chip key={item.key} item={item} today={data.today} />
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <DaySheet date={openDay} data={data} writable={writable} onClose={() => setOpenDay(null)} />
    </div>
  );
}
