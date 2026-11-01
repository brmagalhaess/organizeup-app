"use client";
import { AlertCircle, AlertTriangle, ChevronLeft, ChevronRight, ListFilter } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
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
import { buttonClass, cx } from "@/components/styles";
import { Button, PageHeader, StatTile } from "@/components/ui";
import type { loadCalendar } from "@/lib/calendar-data";
import {
  countByType,
  dayMarks,
  filterDays,
  firstNegativeDay,
  initialDay,
  isOverdue,
  ITEM_TYPES,
  neighborDays,
  TYPE_LABEL,
  type CalendarFilter,
} from "./calendar-model";
import { DayPanel } from "./day-panel";
import { TYPE_DOT, TYPE_ICON, TYPE_TEXT } from "./item-types";

type Data = Awaited<ReturnType<typeof loadCalendar>>;

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MAX_MARKS = 4;

const dayName = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const spokenDay = (date: string) => dayName.format(new Date(`${date}T12:00:00Z`));

function FilterChip({
  active,
  count,
  label,
  onClick,
  icon,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition",
        active
          ? "border-brand-500 bg-brand-900 text-white"
          : "border-line bg-card text-ink hover:bg-brand-50",
      )}
    >
      {icon}
      {label}
      <span className={cx("tabular-nums", active ? "text-sand-100" : "text-muted")}>{count}</span>
    </button>
  );
}

function DayCell({
  date,
  items,
  data,
  weekend,
  selected,
  onSelect,
}: {
  date: string;
  items: CalendarItem[];
  data: Data;
  weekend: boolean;
  selected: boolean;
  onSelect: (date: string) => void;
}) {
  const balance = data.balances[date];
  const negative = balance !== undefined && money(balance).lt(0);
  const isToday = date === data.today;
  const overdue = items.filter((item) => isOverdue(item, data.today)).length;
  const marks = dayMarks(items, data.types);
  const count = items.length === 1 ? "1 item" : `${items.length} itens`;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(date)}
      aria-label={`${spokenDay(date)}${isToday ? ", hoje" : ""}, ${count}${
        overdue > 0 ? `, ${overdue} em atraso` : ""
      }${balance ? `, saldo previsto ${formatBRL(balance)}` : ""}`}
      className={cx(
        "relative flex h-full min-h-12 w-full min-w-0 flex-col items-center gap-1 p-1 text-left transition hover:bg-brand-50 focus-visible:-outline-offset-2 md:min-h-24 md:items-stretch md:p-2",
        weekend ? "bg-card-soft" : "bg-card",
        selected && "ring-2 ring-inset ring-brand-500",
      )}
    >
      <span className="flex items-center justify-between gap-1">
        <span
          className={cx(
            "flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
            isToday ? "bg-brand-900 text-white" : weekend && "font-medium text-muted",
          )}
        >
          {Number(date.slice(8, 10))}
        </span>
        {overdue > 0 ? (
          <AlertCircle className="hidden size-4 text-danger md:block" aria-hidden="true" />
        ) : null}
      </span>

      {/* Celular: só pontos. Os nomes ficam na agenda do dia, logo abaixo da grade. */}
      <span
        aria-hidden="true"
        className="flex min-h-1.5 flex-wrap justify-center gap-0.5 md:hidden"
      >
        {marks.slice(0, MAX_MARKS).map((type) => (
          <span key={type} className={cx("size-1.5 rounded-full", TYPE_DOT[type])} />
        ))}
      </span>

      <span aria-hidden="true" className="hidden flex-wrap items-center gap-1 md:flex">
        {marks.slice(0, MAX_MARKS).map((type) => {
          const Icon = TYPE_ICON[type];
          return <Icon key={type} className={cx("size-4", TYPE_TEXT[type])} />;
        })}
        {marks.length > MAX_MARKS ? (
          <span className="text-xs text-muted">+{marks.length - MAX_MARKS}</span>
        ) : null}
      </span>

      {negative ? (
        <AlertTriangle
          aria-hidden="true"
          className="absolute right-0.5 top-0.5 size-3 text-danger md:hidden"
        />
      ) : null}

      {balance ? (
        <span
          aria-hidden="true"
          className={cx(
            "mt-auto hidden items-center justify-end gap-1 whitespace-nowrap text-xs tabular-nums md:flex",
            negative ? "font-semibold text-danger" : "text-muted",
          )}
        >
          {negative ? <AlertTriangle className="size-3 shrink-0" /> : null}
          {formatBRLShort(balance)}
        </span>
      ) : null}
    </button>
  );
}

function NeighborDay({ day }: { day: number }) {
  return (
    <li aria-hidden="true" className="min-h-12 bg-surface p-1 md:min-h-24 md:p-2">
      <span className="flex size-6 items-center justify-center text-xs text-muted max-md:mx-auto">
        {day}
      </span>
    </li>
  );
}

export function CalendarBoard({
  data,
  writable,
  insights,
}: {
  data: Data;
  writable: boolean;
  insights: ReactNode;
}) {
  const { month, cells, summary, lowest, closing, balances, today } = data;
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState<CalendarFilter>("todos");

  const selected = picked && yearMonthOf(picked) === month ? picked : initialDay(data);
  const counts = useMemo(() => countByType(data.items, data.types), [data.items, data.types]);
  const days = useMemo(
    () => filterDays(data.items, data.types, filter),
    [data.items, data.types, filter],
  );
  const neighbors = useMemo(() => neighborDays(cells, month), [cells, month]);
  const firstNegative = useMemo(() => firstNegativeDay(balances), [balances]);

  const income = money(summary.received).plus(summary.plannedIncome);
  const expense = money(summary.spent).plus(summary.plannedExpense);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const lowestNegative = lowest !== null && money(lowest.balance).lt(0);
  const selectedItems = days[selected] ?? [];
  const monthLink = (target: string) => `/app/calendario?m=${target}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Calendário"
        title={formatYearMonth(month)}
        description="Vencimentos, eventos e quanto deve sobrar a cada dia."
        actions={
          <>
            <Link
              href={monthLink(addMonths(month, -1))}
              aria-label="Mês anterior"
              className={buttonClass("secondary")}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
            {month === data.current ? (
              <Button variant="secondary" onClick={() => setPicked(today)}>
                Hoje
              </Button>
            ) : (
              <Link href="/app/calendario" className={buttonClass("secondary")}>
                Hoje
              </Link>
            )}
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
      {insights}

      {lowestNegative && firstNegative ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-danger-soft p-3 text-sm text-danger"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 basis-60">
            Pelo que está previsto, seu saldo fica negativo em {spokenDay(firstNegative)}. O menor
            valor é <span className="font-semibold">{formatBRL(lowest.balance)}</span>, em{" "}
            {spokenDay(lowest.date)}.
          </p>
          <Button variant="secondary" small onClick={() => setPicked(lowest.date)}>
            Ver o dia
          </Button>
        </div>
      ) : null}

      <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile
          label="Entra"
          tone="receita"
          value={formatBRL(income)}
          hint={`Recebido ${formatBRL(summary.received)}. A receber ${formatBRL(summary.plannedIncome)}.`}
        />
        <StatTile
          label="Sai"
          tone="despesa"
          value={formatBRL(expense)}
          hint={`Pago ${formatBRL(summary.spent)}. A pagar ${formatBRL(summary.plannedExpense)}.`}
        />
        {closing !== null ? (
          <StatTile
            label="Saldo final previsto"
            value={formatBRL(closing)}
            hint="Saldo das contas mais o que está em aberto."
          />
        ) : (
          <StatTile
            label="Resultado do mês"
            value={formatBRL(summary.balance)}
            hint="O que entrou menos o que saiu."
          />
        )}
        <StatTile
          label="Menor saldo"
          tone={lowestNegative ? "despesa" : undefined}
          value={lowest ? formatBRL(lowest.balance) : "Sem previsão"}
          hint={
            lowest
              ? `Em ${formatShortDate(lowest.date)}.`
              : month < data.current
                ? "Só há previsão de hoje em diante."
                : "A previsão vai até 24 meses à frente."
          }
        />
      </dl>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <section
          aria-label="Mês em grade"
          className="min-w-0 rounded-2xl border border-line bg-card p-3 shadow-card sm:p-5"
        >
          <div role="group" aria-label="Filtrar por tipo" className="flex flex-wrap gap-1.5">
            <FilterChip
              label="Todos"
              count={total}
              active={filter === "todos"}
              onClick={() => setFilter("todos")}
              icon={<ListFilter className="size-4" aria-hidden="true" />}
            />
            {ITEM_TYPES.map((type) => {
              const Icon = TYPE_ICON[type];
              const active = filter === type;
              return (
                <FilterChip
                  key={type}
                  label={TYPE_LABEL[type]}
                  count={counts[type]}
                  active={active}
                  onClick={() => setFilter(active ? "todos" : type)}
                  icon={
                    <Icon className={cx("size-4", !active && TYPE_TEXT[type])} aria-hidden="true" />
                  }
                />
              );
            })}
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-line">
            <div
              aria-hidden="true"
              className="grid grid-cols-7 gap-px bg-line text-center text-xs font-medium text-muted"
            >
              {WEEKDAYS.map((day) => (
                <span key={day} className="bg-card-soft py-1.5">
                  {day}
                </span>
              ))}
            </div>
            <ol
              aria-label="Dias do mês"
              className="m-0 grid list-none grid-cols-7 gap-px border-t border-line bg-line p-0"
            >
              {neighbors.before.map((day) => (
                <NeighborDay key={`antes-${day}`} day={day} />
              ))}
              {cells.days.map((date, index) => {
                const position = (cells.leading + index) % 7;
                return (
                  <li key={date} className="min-w-0">
                    <DayCell
                      date={date}
                      items={days[date] ?? []}
                      data={data}
                      weekend={position === 0 || position === 6}
                      selected={date === selected}
                      onSelect={setPicked}
                    />
                  </li>
                );
              })}
              {neighbors.after.map((day) => (
                <NeighborDay key={`depois-${day}`} day={day} />
              ))}
            </ol>
          </div>
        </section>

        <DayPanel
          date={selected}
          items={selectedItems}
          hidden={(data.items[selected] ?? []).length - selectedItems.length}
          filter={filter}
          data={data}
          writable={writable}
        />
      </div>
    </div>
  );
}
