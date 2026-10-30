// Reserva de emergência e patrimônio. Puro: recebe valores e devolve o que a tela mostra.
import { purchaseLines, linesTotal, type CardTerms, type PurchaseInput } from "./card";
import { money, toDbAmount } from "./money";

export const DEFAULT_RESERVE_MONTHS = 6;

export type BaselineBasis = "informado" | "media" | "mes_atual" | "sem_dados";

export interface EssentialBaseline {
  monthly: string;
  basis: BaselineBasis;
  /** Meses usados na média. */
  months: number;
}

/**
 * Gasto essencial por mês que a reserva precisa cobrir: o valor informado, ou a média dos
 * meses fechados com gasto, ou o mês atual com as previsões, para quem acabou de começar.
 */
export function essentialBaseline(
  closedMonths: string[],
  currentMonth: string,
  informed: string | null,
): EssentialBaseline {
  if (informed !== null && money(informed).gt(0))
    return { monthly: toDbAmount(informed), basis: "informado", months: 0 };
  const withData = closedMonths.filter((total) => money(total).gt(0));
  if (withData.length > 0) {
    const sum = withData.reduce((acc, total) => acc.plus(total), money(0));
    return {
      monthly: toDbAmount(sum.dividedBy(withData.length)),
      basis: "media",
      months: withData.length,
    };
  }
  if (money(currentMonth).gt(0))
    return { monthly: toDbAmount(currentMonth), basis: "mes_atual", months: 1 };
  return { monthly: "0.00", basis: "sem_dados", months: 0 };
}

export interface ReserveStatus {
  target: string;
  saved: string;
  missing: string;
  /** 0 a 100. */
  percent: number;
  /** Meses de gasto essencial que o guardado cobre. */
  coveredMonths: number;
}

export function reserveStatus(saved: string, monthly: string, targetMonths: number): ReserveStatus {
  const target = money(monthly).times(targetMonths);
  const guarded = money(saved).gt(0) ? money(saved) : money(0);
  const missing = target.minus(guarded);
  return {
    target: toDbAmount(target),
    saved: toDbAmount(saved),
    missing: toDbAmount(missing.gt(0) ? missing : 0),
    percent: target.isZero()
      ? 0
      : Math.min(100, guarded.dividedBy(target).times(100).toDecimalPlaces(0).toNumber()),
    coveredMonths: money(monthly).isZero()
      ? 0
      : guarded.dividedBy(monthly).toDecimalPlaces(1).toNumber(),
  };
}

/** Meses até completar a reserva guardando `contribution` por mês. Null se não houver aporte. */
export function monthsToReserve(missing: string, contribution: string): number | null {
  const each = money(contribution);
  if (each.lte(0)) return null;
  return money(missing).dividedBy(each).ceil().toNumber();
}

export interface NetWorthAccount {
  id: string;
  name: string;
  balance: string;
  archived: boolean;
}

export interface NetWorthAsset {
  id: string;
  value: string;
}

export interface NetWorthDebt {
  id: string;
  name: string;
  /** Soma da amortização das parcelas em aberto. */
  balance: string;
  archived: boolean;
}

export interface NetWorthCard extends CardTerms {
  id: string;
  name: string;
}

export interface NetWorthInput {
  accounts: NetWorthAccount[];
  assets: NetWorthAsset[];
  debts: NetWorthDebt[];
  cards: NetWorthCard[];
  purchases: PurchaseInput[];
  /** Faturas pagas, como `cartão:mês`. */
  paidStatements: string[];
}

export interface NetWorthSummary {
  accounts: string;
  assets: string;
  debts: string;
  cards: string;
  owned: string;
  owed: string;
  net: string;
  cardBalances: Array<{ id: string; name: string; balance: string }>;
}

const sumOf = (values: string[]) => values.reduce((acc, value) => acc.plus(value), money(0));

/**
 * Patrimônio líquido: contas ativas e bens, menos dívidas ativas e tudo que ainda vai sair dos
 * cartões, inclusive parcelas futuras. Compra parcelada já é uma obrigação assumida.
 */
export function summarizeNetWorth(input: NetWorthInput): NetWorthSummary {
  const paid = new Set(input.paidStatements);
  const cardBalances = input.cards
    .map((card) => {
      const lines = input.purchases
        .filter((purchase) => purchase.cardId === card.id)
        .flatMap((purchase) => purchaseLines(purchase, card))
        .filter((line) => !paid.has(`${card.id}:${line.statementMonth}`));
      return { id: card.id, name: card.name, balance: linesTotal(lines) };
    })
    .filter((card) => money(card.balance).gt(0));

  const accounts = sumOf(input.accounts.filter((a) => !a.archived).map((a) => a.balance));
  const assets = sumOf(input.assets.map((a) => a.value));
  const debts = sumOf(input.debts.filter((d) => !d.archived).map((d) => d.balance));
  const cards = sumOf(cardBalances.map((c) => c.balance));
  const owned = accounts.plus(assets);
  const owed = debts.plus(cards);
  return {
    accounts: toDbAmount(accounts),
    assets: toDbAmount(assets),
    debts: toDbAmount(debts),
    cards: toDbAmount(cards),
    owned: toDbAmount(owned),
    owed: toDbAmount(owed),
    net: toDbAmount(owned.minus(owed)),
    cardBalances,
  };
}
