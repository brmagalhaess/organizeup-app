// Regras do calendário: grade do mês, itens de cada dia e saldo previsto. Puro.
import { daysInMonth, occurrenceDate, type MonthEntry, type YearMonth } from "./cashflow";
import { money, toDbAmount } from "./money";

export interface MonthCells {
  /** Casas vazias antes do dia 1, com a semana começando no domingo. */
  leading: number;
  days: string[];
}

export function monthCells(ym: YearMonth): MonthCells {
  const [year, month] = ym.split("-").map(Number) as [number, number];
  return {
    leading: new Date(Date.UTC(year, month - 1, 1)).getUTCDay(),
    days: Array.from({ length: daysInMonth(ym) }, (_, index) => occurrenceDate(index + 1, ym)),
  };
}

export interface CalendarEvent {
  id: string;
  title: string;
  eventDate: string;
  yearly: boolean;
}

export interface EventOccurrence {
  id: string;
  title: string;
  date: string;
  yearly: boolean;
}

/** Compromissos do mês. Anual repete a partir do ano original; 29/02 cai em 28 nos outros anos. */
export function eventsInMonth(events: CalendarEvent[], ym: YearMonth): EventOccurrence[] {
  return events.flatMap((event) => {
    const original = event.eventDate.slice(0, 7);
    const sameMonthOfYear = original.slice(5) === ym.slice(5);
    const occurs = event.yearly ? sameMonthOfYear && ym >= original : original === ym;
    if (!occurs) return [];
    return [
      {
        id: event.id,
        title: event.title,
        date: occurrenceDate(Number(event.eventDate.slice(8, 10)), ym),
        yearly: event.yearly,
      },
    ];
  });
}

export type CalendarItem =
  | {
      type: "lancamento";
      key: string;
      date: string;
      title: string;
      amount: string;
      kind: MonthEntry["kind"];
      status: MonthEntry["status"];
      source: MonthEntry["source"];
    }
  | { type: "compromisso"; key: string; id: string; date: string; title: string; yearly: boolean }
  | { type: "fechamento"; key: string; date: string; title: string };

const ORDER: Record<CalendarItem["type"], number> = {
  compromisso: 0,
  lancamento: 1,
  fechamento: 2,
};

/** Junta tudo por dia: compromissos primeiro, depois dinheiro, depois fechamentos de fatura. */
export function groupCalendarItems(
  entries: MonthEntry[],
  events: EventOccurrence[],
  cards: Array<{ id: string; name: string; closingDay: number }>,
  ym: YearMonth,
): Record<string, CalendarItem[]> {
  const items: CalendarItem[] = [
    ...entries.map((entry): CalendarItem => ({
      type: "lancamento",
      key: entry.key,
      date: entry.date,
      title: entry.description,
      amount: entry.amount,
      kind: entry.kind,
      status: entry.status,
      source: entry.source,
    })),
    ...events.map((event): CalendarItem => ({
      type: "compromisso",
      key: `e:${event.id}:${event.date}`,
      id: event.id,
      date: event.date,
      title: event.title,
      yearly: event.yearly,
    })),
    ...cards.map((card): CalendarItem => ({
      type: "fechamento",
      key: `c:${card.id}:${ym}`,
      date: occurrenceDate(card.closingDay, ym),
      title: `Fecha ${card.name}`,
    })),
  ];
  const days: Record<string, CalendarItem[]> = {};
  for (const item of items.sort((a, b) => ORDER[a.type] - ORDER[b.type])) {
    (days[item.date] ??= []).push(item);
  }
  return days;
}

/**
 * Saldo previsto ao fim de cada dia, de hoje em diante: o saldo atual das contas mais tudo que
 * ainda está em aberto até aquele dia. O que venceu e não foi pago conta como saindo hoje.
 */
export function projectDailyBalance(
  balance: string,
  today: string,
  pending: Array<Pick<MonthEntry, "date" | "amount" | "kind">>,
  days: string[],
): Record<string, string> {
  const sorted = [...pending].sort((a, b) => a.date.localeCompare(b.date));
  const result: Record<string, string> = {};
  let running = money(balance);
  let next = 0;
  for (const day of [...days].sort()) {
    if (day < today) continue;
    while (next < sorted.length && sorted[next]!.date <= day) {
      const entry = sorted[next]!;
      running = entry.kind === "receita" ? running.plus(entry.amount) : running.minus(entry.amount);
      next += 1;
    }
    result[day] = toDbAmount(running);
  }
  return result;
}

/** Dia de menor saldo previsto, o primeiro em caso de empate. */
export function lowestBalance(
  balances: Record<string, string>,
): { date: string; balance: string } | null {
  let lowest: { date: string; balance: string } | null = null;
  for (const date of Object.keys(balances).sort()) {
    const balance = balances[date]!;
    if (!lowest || money(balance).lt(lowest.balance)) lowest = { date, balance };
  }
  return lowest;
}
