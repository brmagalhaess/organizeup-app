// Uso do cartão mês a mês: o total de cada fatura, sem o saldo que veio de uma fatura paga em parte (ele é
// dívida da fatura anterior, e não gasto novo). Sem React e sem banco, para testar.
import { addMonths, money, toDbAmount, type YearMonth } from "@organizeup/domain";

export interface UsageCard {
  id: string;
  lines: Array<{ statementMonth: string; amount: string }>;
  /** Mês da fatura paga em parte e quanto dela foi para a seguinte. */
  carried: Record<string, string>;
}

export type UsageState = "fechada" | "aberta" | "futura";

export interface UsagePoint {
  month: YearMonth;
  total: string;
  state: UsageState;
}

export interface CardUsage {
  points: UsagePoint[];
  /** Média das faturas fechadas da janela, a partir do primeiro mês com compra. Null sem fatura fechada. */
  average: string | null;
  /** Fatura em aberto contra a fechada anterior, em %. Null quando a anterior é zero. */
  change: number | null;
}

/** Quantas faturas fechadas, a em aberto e quantas futuras (parcelas já compradas) entram no gráfico. */
export const USAGE_PAST = 8;
export const USAGE_AHEAD = 3;

export function cardUsage(cards: UsageCard[], openMonth: YearMonth): CardUsage {
  const totals = new Map<string, ReturnType<typeof money>>();
  const add = (month: string, amount: ReturnType<typeof money>) =>
    totals.set(month, (totals.get(month) ?? money(0)).plus(amount));
  for (const card of cards) {
    for (const line of card.lines) add(line.statementMonth, money(line.amount));
    for (const [month, amount] of Object.entries(card.carried)) {
      add(addMonths(month as YearMonth, 1), money(amount).negated());
    }
  }
  const points: UsagePoint[] = [];
  for (let step = -USAGE_PAST; step <= USAGE_AHEAD; step += 1) {
    const month = addMonths(openMonth, step);
    const total = totals.get(month) ?? money(0);
    points.push({
      month,
      // Saldo apagado à mão pode deixar a conta negativa: uso nunca é menor que zero.
      total: toDbAmount(total.lt(0) ? money(0) : total),
      state: step < 0 ? "fechada" : step === 0 ? "aberta" : "futura",
    });
  }
  const closed = points.filter((point) => point.state === "fechada");
  const first = closed.findIndex((point) => money(point.total).gt(0));
  const counted = first < 0 ? [] : closed.slice(first);
  const average =
    counted.length === 0
      ? null
      : toDbAmount(
          counted.reduce((acc, point) => acc.plus(point.total), money(0)).div(counted.length),
        );
  const previous = closed.at(-1);
  const open = points.find((point) => point.state === "aberta")!;
  const change =
    previous && money(previous.total).gt(0)
      ? Math.round(
          money(open.total).minus(previous.total).div(previous.total).times(100).toNumber(),
        )
      : null;
  return { points, average, change };
}

/** Topo do eixo: o primeiro número redondo (1, 2, 2,5 ou 5 vezes uma potência de dez) que cobre o maior valor. */
export function axisTop(max: number): number {
  if (!(max > 0)) return 0;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * power >= max) ?? 10;
  return step * power;
}
