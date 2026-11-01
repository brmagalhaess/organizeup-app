// Contas da tela do calendário. Puro: tudo sai dos dados já carregados, sem consulta por dia.
import type { CalendarItemType } from "@organizeup/agents";
import {
  addMonths,
  daysInMonth,
  money,
  yearMonthOf,
  type CalendarItem,
  type MonthCells,
} from "@organizeup/domain";

export type CalendarFilter = CalendarItemType | "todos";

export const ITEM_TYPES: CalendarItemType[] = [
  "conta",
  "receita",
  "cartao",
  "divida",
  "meta",
  "viagem",
  "evento",
];

type DayItems = Record<string, CalendarItem[]>;
type ItemTypes = Record<string, CalendarItemType>;

export const typeOf = (item: CalendarItem, types: ItemTypes): CalendarItemType =>
  types[item.key] ?? "evento";

/** Quantos itens de cada tipo há no mês, para o filtro. */
export function countByType(items: DayItems, types: ItemTypes) {
  const counts = Object.fromEntries(ITEM_TYPES.map((type) => [type, 0])) as Record<
    CalendarItemType,
    number
  >;
  for (const item of Object.values(items).flat()) counts[typeOf(item, types)] += 1;
  return counts;
}

/** Só os itens do tipo escolhido, dia a dia. */
export function filterDays(items: DayItems, types: ItemTypes, filter: CalendarFilter): DayItems {
  if (filter === "todos") return items;
  const days: DayItems = {};
  for (const [date, list] of Object.entries(items)) {
    const kept = list.filter((item) => typeOf(item, types) === filter);
    if (kept.length > 0) days[date] = kept;
  }
  return days;
}

/** Tipos do dia sem repetir, na ordem em que aparecem: uma marca por tipo. */
export function dayMarks(list: CalendarItem[], types: ItemTypes): CalendarItemType[] {
  return [...new Set(list.map((item) => typeOf(item, types)))];
}

/** Dia aberto ao chegar no mês: hoje, o primeiro dia com algo, ou o dia 1. */
export function initialDay(input: {
  month: string;
  today: string;
  cells: MonthCells;
  items: DayItems;
}): string {
  if (yearMonthOf(input.today) === input.month) return input.today;
  return (
    input.cells.days.find((day) => (input.items[day] ?? []).length > 0) ?? input.cells.days[0]!
  );
}

/** Números dos dias vizinhos que completam a primeira e a última semana da grade. */
export function neighborDays(cells: MonthCells, month: string) {
  const previous = daysInMonth(addMonths(month, -1));
  const before = Array.from(
    { length: cells.leading },
    (_, index) => previous - cells.leading + index + 1,
  );
  const filled = (cells.leading + cells.days.length) % 7;
  const after = Array.from({ length: filled === 0 ? 0 : 7 - filled }, (_, index) => index + 1);
  return { before, after };
}

/** Primeiro dia com saldo previsto negativo. */
export function firstNegativeDay(balances: Record<string, string>): string | null {
  return (
    Object.keys(balances)
      .sort()
      .find((date) => money(balances[date]!).lt(0)) ?? null
  );
}

export const isOverdue = (item: CalendarItem, today: string) =>
  item.type === "lancamento" && item.status === "previsto" && item.date < today;

/** Tela onde o item é tratado. Evento fica no próprio calendário; meta usa o link do plano. */
export function itemHref(item: CalendarItem, type: CalendarItemType): string | null {
  switch (type) {
    case "cartao":
      return "/app/cartoes";
    case "divida":
      return "/app/dividas";
    case "viagem":
      return "/app/viagens";
    case "meta":
      return item.type === "lancamento" && item.source === "meta" ? null : "/app/metas";
    case "receita":
      return item.type === "lancamento" && item.source === "renda"
        ? "/app/renda"
        : `/app/lancamentos?m=${yearMonthOf(item.date)}`;
    case "conta":
      return `/app/lancamentos?m=${yearMonthOf(item.date)}`;
    default:
      return null;
  }
}
