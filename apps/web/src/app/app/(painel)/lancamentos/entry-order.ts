// Ordem e resumos da lista de Lançamentos. Sem React, para testar.
import { money, toDbAmount } from "@organizeup/domain";

interface Dated {
  date: string;
}

/**
 * O que já aconteceu (ou já devia ter acontecido) vem primeiro, do dia mais recente para o mais antigo: hoje
 * fica no topo. O que ainda vai vencer vem depois, do mais próximo para o mais distante. Dentro do mesmo dia a
 * ordem de chegada se mantém.
 */
export function orderEntries<T extends Dated>(
  entries: T[],
  today: string,
): { recent: T[]; upcoming: T[] } {
  const recent = entries
    .filter((entry) => entry.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));
  const upcoming = entries
    .filter((entry) => entry.date > today)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { recent, upcoming };
}

interface Open extends Dated {
  status: "previsto" | "realizado";
  kind: "receita" | "despesa";
  amount: string;
}

export interface OpenSummary {
  count: number;
  /** Em aberto com a data já passada. */
  overdue: number;
  toPay: string;
  toReceive: string;
}

/** O que ainda está em aberto no mês: quantos, quantos atrasados e quanto falta pagar e receber. */
export function openSummary(entries: Open[], today: string): OpenSummary {
  const open = entries.filter((entry) => entry.status === "previsto");
  const sum = (kind: Open["kind"]) =>
    toDbAmount(
      open
        .filter((entry) => entry.kind === kind)
        .reduce((acc, entry) => acc.plus(entry.amount), money(0)),
    );
  return {
    count: open.length,
    overdue: open.filter((entry) => entry.date < today).length,
    toPay: sum("despesa"),
    toReceive: sum("receita"),
  };
}

/** Entradas e saídas do que está na lista, para o resumo do filtro. */
export function listTotals(entries: Array<Pick<Open, "kind" | "amount">>): {
  incoming: string;
  outgoing: string;
} {
  const sum = (kind: Open["kind"]) =>
    toDbAmount(
      entries
        .filter((entry) => entry.kind === kind)
        .reduce((acc, entry) => acc.plus(entry.amount), money(0)),
    );
  return { incoming: sum("receita"), outgoing: sum("despesa") };
}
