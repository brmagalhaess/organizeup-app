// Regras de cartão de crédito. Parcelas e faturas são calculadas a partir das compras.
import { addMonths, occurrenceDate, yearMonthOf, type YearMonth } from "./cashflow";
import { money, splitInstallments, toDbAmount } from "./money";

/** Categoria da fatura no fluxo do mês; o detalhe por categoria vem das compras. */
export const CARD_CATEGORY = "Cartão de crédito";

export interface CardTerms {
  closingDay: number;
  dueDay: number;
}

export interface PurchaseInput {
  id: string;
  cardId: string;
  categoryId: string;
  description: string;
  amount: string;
  installments: number;
  purchasedOn: string;
}

export interface StatementLine {
  purchaseId: string;
  cardId: string;
  categoryId: string;
  description: string;
  purchasedOn: string;
  installment: number;
  installments: number;
  amount: string;
  statementMonth: YearMonth;
}

/**
 * Fatura em que uma compra cai, identificada pelo mês de vencimento.
 * Compra no dia do fechamento ainda entra na fatura que está fechando.
 */
export function statementMonthOf(date: string, terms: CardTerms): YearMonth {
  const month = yearMonthOf(date);
  const closesThisMonth = date <= occurrenceDate(terms.closingDay, month);
  const closingMonth = closesThisMonth ? month : addMonths(month, 1);
  return terms.dueDay > terms.closingDay ? closingMonth : addMonths(closingMonth, 1);
}

export function statementDueDate(month: YearMonth, terms: CardTerms): string {
  return occurrenceDate(terms.dueDay, month);
}

export function statementClosingDate(month: YearMonth, terms: CardTerms): string {
  const closingMonth = terms.dueDay > terms.closingDay ? month : addMonths(month, -1);
  return occurrenceDate(terms.closingDay, closingMonth);
}

/** Uma linha por parcela, cada uma na sua fatura; a soma é o valor da compra. */
export function purchaseLines(purchase: PurchaseInput, terms: CardTerms): StatementLine[] {
  const first = statementMonthOf(purchase.purchasedOn, terms);
  return splitInstallments(purchase.amount, purchase.installments).map((amount, index) => ({
    purchaseId: purchase.id,
    cardId: purchase.cardId,
    categoryId: purchase.categoryId,
    description: purchase.description,
    purchasedOn: purchase.purchasedOn,
    installment: index + 1,
    installments: purchase.installments,
    amount: toDbAmount(amount),
    statementMonth: addMonths(first, index),
  }));
}

export type StatementStatus = "aberta" | "fechada" | "atrasada" | "paga";

export function statementStatus(
  month: YearMonth,
  terms: CardTerms,
  today: string,
  paid: boolean,
): StatementStatus {
  if (paid) return "paga";
  if (today > statementDueDate(month, terms)) return "atrasada";
  return today > statementClosingDate(month, terms) ? "fechada" : "aberta";
}

export function linesTotal(lines: Pick<StatementLine, "amount">[]): string {
  return toDbAmount(lines.reduce((acc, line) => acc.plus(line.amount), money(0)));
}
