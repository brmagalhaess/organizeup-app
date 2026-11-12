// Contas que a tela de Patrimônio mostra a partir do resumo: a fatia de cada parte do que a pessoa tem, a
// variação contra a foto do mês anterior e o peso do que ela deve. Sem React e sem banco, para testar.
import { money, toDbAmount } from "@organizeup/domain";

export const NET_WORTH_PARTS = ["accounts", "investments", "assets", "goals"] as const;
export type NetWorthPartKey = (typeof NET_WORTH_PARTS)[number];

export interface NetWorthPart {
  key: NetWorthPartKey;
  value: string;
  /** Fatia no total das partes positivas, de 0 a 100. Parte negativa ou zerada fica com 0. */
  percent: number;
}

/**
 * Fatia de cada parte. Conta negativa diminui o que a pessoa tem, mas não tem fatia para desenhar: a barra
 * usa só as partes positivas, e a lista mostra o valor negativo ao lado.
 */
export function netWorthParts(summary: Record<NetWorthPartKey, string>): NetWorthPart[] {
  const positive = NET_WORTH_PARTS.map((key) =>
    money(summary[key]).gt(0) ? money(summary[key]) : money(0),
  );
  const total = positive.reduce((acc, value) => acc.plus(value), money(0));
  return NET_WORTH_PARTS.map((key, index) => ({
    key,
    value: summary[key],
    percent: total.isZero()
      ? 0
      : positive[index]!.dividedBy(total).times(100).toDecimalPlaces(1).toNumber(),
  }));
}

export interface NetWorthChange {
  /** Mês da foto usada na comparação. */
  month: string;
  /** Patrimônio de hoje menos o da foto. */
  amount: string;
  direction: "subiu" | "caiu" | "igual";
}

/** Variação contra a foto mais recente de um mês anterior ao atual. Null sem foto para comparar. */
export function netWorthChange(
  history: Array<{ month: string; net: string }>,
  currentMonth: string,
  net: string,
): NetWorthChange | null {
  const previous = history
    .filter((point) => point.month < currentMonth)
    .sort((a, b) => a.month.localeCompare(b.month))
    .at(-1);
  if (!previous) return null;
  const amount = money(net).minus(previous.net);
  return {
    month: previous.month,
    amount: toDbAmount(amount),
    direction: amount.gt(0) ? "subiu" : amount.lt(0) ? "caiu" : "igual",
  };
}

/** Quanto o que a pessoa deve representa do que ela tem, de 0 a 100. Null quando deve mais do que tem. */
export function debtShare(owned: string, owed: string): number | null {
  if (money(owed).lte(0)) return 0;
  if (money(owned).lte(0) || money(owed).gt(owned)) return null;
  return money(owed).dividedBy(owned).times(100).toDecimalPlaces(1).toNumber();
}
