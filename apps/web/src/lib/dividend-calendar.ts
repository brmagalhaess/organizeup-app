// Calendário de dividendos: grade do mês e os eventos (data-com e pagamento) de cada dia. Sem React.
import { monthBounds, type YearMonth } from "@organizeup/domain";

export interface CalendarEvent {
  id: string;
  ticker: string;
  name: string | null;
  assetClass: string | null;
  kind: "dividendo" | "jcp" | "rendimento";
  comDate: string;
  payDate: string;
  ratePerShare: string;
  /** A família ainda tem o ativo, ou já tem direito a este provento e ainda vai receber (`isMineEvent`). */
  mine: boolean;
  /** Quantidade na data-com e quanto entra; null quando o ativo não é da família ou não havia posição. */
  quantity: string | null;
  amount: string | null;
}

const positive = (quantity: string) => Number(quantity) > 0;

/**
 * O provento é "meu" quando ainda tenho o ativo. Ativo vendido por inteiro sai, mesmo com o histórico de
 * operações guardado. A exceção é o provento a que já tenho direito e que ainda não foi pago: vendi depois
 * da data-com, então o dinheiro ainda entra.
 */
export function isMineEvent(position: {
  /** Quantidade hoje. */
  held: string;
  /** Quantidade com direito na data-com. */
  entitled: string;
  payDate: string;
  today: string;
}): boolean {
  if (positive(position.held)) return true;
  return positive(position.entitled) && position.payDate >= position.today;
}

export type CalendarEntryType = "com" | "pagamento";

export interface CalendarEntry {
  type: CalendarEntryType;
  event: CalendarEvent;
}

export interface CalendarDay {
  date: string;
  inMonth: boolean;
}

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

/** Semanas do mês, de domingo a sábado, completando com dias vizinhos: sempre 6 linhas de 7. */
export function monthGrid(month: YearMonth): CalendarDay[][] {
  const { first } = monthBounds(month);
  const start = new Date(`${first}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < 6; week++) {
    const days: CalendarDay[] = [];
    for (let day = 0; day < 7; day++) {
      const date = dayOf(start);
      days.push({ date, inMonth: date.startsWith(month) });
      start.setUTCDate(start.getUTCDate() + 1);
    }
    weeks.push(days);
  }
  return weeks;
}

/** Eventos por dia do mês: a data-com e o pagamento de cada provento, só os que caem no mês. */
export function entriesByDay(
  events: CalendarEvent[],
  month: YearMonth,
): Map<string, CalendarEntry[]> {
  const out = new Map<string, CalendarEntry[]>();
  const push = (date: string, entry: CalendarEntry) => {
    if (!date.startsWith(month)) return;
    out.set(date, [...(out.get(date) ?? []), entry]);
  };
  for (const event of events) {
    push(event.comDate, { type: "com", event });
    push(event.payDate, { type: "pagamento", event });
  }
  for (const entries of out.values()) {
    // Pagamentos antes das datas-com; dentro de cada tipo, os seus ativos primeiro, depois o código.
    entries.sort(
      (a, b) =>
        Number(a.type === "com") - Number(b.type === "com") ||
        Number(b.event.mine) - Number(a.event.mine) ||
        a.event.ticker.localeCompare(b.event.ticker),
    );
  }
  return out;
}

/** Meses que dá para escolher: dois anos para trás e três meses à frente do mês de hoje. */
export function monthChoices(today: string): YearMonth[] {
  const [year, month] = today.split("-").map(Number) as [number, number];
  const out: YearMonth[] = [];
  for (let delta = -24; delta <= 3; delta++) {
    const date = new Date(Date.UTC(year, month - 1 + delta, 1));
    out.push(date.toISOString().slice(0, 7) as YearMonth);
  }
  return out;
}

export const isYearMonth = (value: string | undefined): value is YearMonth =>
  typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
