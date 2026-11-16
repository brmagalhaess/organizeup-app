// Regras de cartão de crédito. Parcelas e faturas são calculadas a partir das compras.
import { addMonths, occurrenceDate, yearMonthOf, type YearMonth } from "./cashflow";
import { addDays } from "./income-plan";
import { money, splitInstallments, toDbAmount } from "./money";
import { normalizeDescription } from "./statement";

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

/**
 * A linha do extrato da conta PARECE pagamento de fatura de cartão? Serve só para sugerir: quem decide é a
 * família, na tela de cartões (ADR-0043). Por isso aceita "fatura" de qualquer coisa, e só recusa o que é
 * claramente outra coisa: compra, cartão de débito, boleto.
 */
export function looksLikeCardBill(description: string): boolean {
  const text = normalizeDescription(description);
  if (/\bcompra\b|\bboleto\b|\bcartao (de )?debito\b|\belectron\b|\bmaestro\b/.test(text)) {
    return false;
  }
  if (/\bfat(ura)?\b/.test(text)) return true;
  return /\b(pag(amento|to)?|pgto|pgt|deb(ito)?|gastos)\b/.test(text) && /\bcartao\b/.test(text);
}

/**
 * A fatura que um pagamento feito em `date` quita: a primeira que vence a partir de `graceDays` antes dele.
 * Pago até alguns dias depois do vencimento, ainda é a fatura que venceu; depois disso, já é da seguinte.
 */
export function statementPaidOn(date: string, terms: CardTerms, graceDays: number): YearMonth {
  const from = addDays(date, -graceDays);
  const month = yearMonthOf(from);
  return statementDueDate(month, terms) >= from ? month : addMonths(month, 1);
}

/** Como o débito entra numa fatura que já tem pagamento. */
export type JoinMode = "auto" | "marcado" | "extra";

export interface JoinInput {
  /** Valor do débito que a família está juntando. */
  amount: string;
  /** Valor atual do pagamento principal da fatura. */
  mainAmount: string;
  /** O pagamento principal foi marcado à mão (sem vir do banco)? */
  mainByHand: boolean;
  /** O "Saldo da fatura" que esta fatura levou para a seguinte; "0.00" sem saldo. */
  carry: string;
  mode: JoinMode;
}

/**
 * Quanto do débito toma o lugar do que a família marcou à mão. O resto do débito é pagamento a mais, e
 * diminui o saldo levado para a fatura seguinte.
 * - Pagamento principal do banco: nada é trocado, o débito é todo pagamento a mais.
 * - Marcado à mão, modo automático: o débito igual ao saldo levado é o complemento que faltava, e não troca
 *   nada; qualquer outro é o próprio pagamento marcado aparecendo no banco, e troca até o valor marcado.
 * - A família pode dizer qual dos dois é ("marcado" ou "extra").
 */
export function joinReplaces(input: JoinInput): string {
  if (!input.mainByHand || input.mode === "extra") return "0.00";
  const complement = money(input.carry).gt(0) && money(input.amount).eq(input.carry);
  if (input.mode === "auto" && complement) return "0.00";
  const amount = money(input.amount);
  return toDbAmount(amount.gt(input.mainAmount) ? money(input.mainAmount) : amount);
}

/** O que a fatura leva para a seguinte: o total menos tudo o que foi pago por ela, nunca negativo. */
export function statementCarry(total: string, paid: string[]): string {
  const rest = paid.reduce((acc, value) => acc.minus(value), money(total));
  return toDbAmount(rest.gt(0) ? rest : money(0));
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
