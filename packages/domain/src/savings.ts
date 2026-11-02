// O que é dinheiro guardado (ADR-0027). Uma definição só: tudo o que separa aporte de despesa e resgate
// de receita passa por `savingsDestination`, e ninguém compara nome de categoria fora daqui. Puro.
import type { EntryKind } from "./cashflow";
import { normalizeDescription } from "./statement";

/** Categoria de sistema das parcelas de metas (despesa na origem, receita no destino). */
export const GOAL_CATEGORY = "Metas e objetivos";
/** Categoria de sistema dos aportes em investimentos e reserva. */
export const CONTRIBUTION_CATEGORY = "Aportes e investimentos";

/**
 * `position` que os modelos `d-metas`, `r-metas` e `d-aportes` gravam na categoria da família. Nada no
 * produto muda esse número, e categoria criada pela família fica com 100. Por isso ele sobrevive a quem
 * renomeia a categoria: o nome pode ser qualquer um, em qualquer idioma. Um teste confere com o banco.
 */
export const SAVINGS_TEMPLATE_POSITION = { goal: 90, investment: 91 } as const;

export type SavingsDestination = "investimento" | "meta";

export interface SavingsCategoryRow {
  id: string;
  name: string;
  kind: EntryKind;
  position: number;
}

/** Para onde vai o que entra nesta categoria, pelo modelo que a criou ou, sem ele, pelo nome de sistema. */
export function savingsCategory(row: Omit<SavingsCategoryRow, "id">): SavingsDestination | null {
  const name = normalizeDescription(row.name);
  if (row.position === SAVINGS_TEMPLATE_POSITION.goal) return "meta";
  if (name === normalizeDescription(GOAL_CATEGORY)) return "meta";
  if (row.kind === "despesa" && row.position === SAVINGS_TEMPLATE_POSITION.investment) {
    return "investimento";
  }
  return name === normalizeDescription(CONTRIBUTION_CATEGORY) ? "investimento" : null;
}

/** O que identifica dinheiro guardado numa família. Monte com `savingsRule`. */
export interface SavingsRule {
  investmentCategories: ReadonlySet<string>;
  goalCategories: ReadonlySet<string>;
  /** Lançamentos gerados por uma operação: valem mesmo se a família trocar a categoria deles. */
  investmentTransactions: ReadonlySet<string>;
  /** Lançamentos de parcela de meta. */
  goalTransactions: ReadonlySet<string>;
}

/** Marca, em `household_notifications`, que a nota do painel sobre aportes já foi fechada. */
export const SAVINGS_NOTICE_KEY = "aviso:aporte-separado";

/** Nada é guardado, nem parcela de meta: as somas ficam como eram antes do ADR-0027. É o "antes" dos testes. */
export const NO_SAVINGS: SavingsRule = {
  investmentCategories: new Set(),
  goalCategories: new Set(),
  investmentTransactions: new Set(),
  goalTransactions: new Set(),
};

export function savingsRule(input: {
  categories: SavingsCategoryRow[];
  tradeTransactionIds: Iterable<string | null>;
  goalTransactionIds: Iterable<string | null>;
}): SavingsRule {
  const present = (ids: Iterable<string | null>) =>
    new Set([...ids].filter((id): id is string => id !== null));
  const of = (destination: SavingsDestination) =>
    new Set(input.categories.filter((c) => savingsCategory(c) === destination).map((c) => c.id));
  return {
    investmentCategories: of("investimento"),
    goalCategories: of("meta"),
    investmentTransactions: present(input.tradeTransactionIds),
    goalTransactions: present(input.goalTransactionIds),
  };
}

/** Entrada de qualquer tipo: lançamento, previsão, parcela de meta ou compra de cartão. */
export interface FlowInput {
  categoryId: string;
  /** Id do lançamento. O id de uma previsão nunca está nos conjuntos da regra. */
  id?: string;
  /** Parcela de meta ainda não confirmada: não tem lançamento, e pode não ter categoria. */
  source?: string;
}

/** A definição: para onde foi o dinheiro desta entrada. Null é receita ou despesa de verdade. */
export function savingsDestination(entry: FlowInput, rule: SavingsRule): SavingsDestination | null {
  if (rule === NO_SAVINGS) return null;
  if (entry.source === "meta") return "meta";
  if (entry.id !== undefined) {
    if (rule.goalTransactions.has(entry.id)) return "meta";
    if (rule.investmentTransactions.has(entry.id)) return "investimento";
  }
  if (rule.goalCategories.has(entry.categoryId)) return "meta";
  return rule.investmentCategories.has(entry.categoryId) ? "investimento" : null;
}

export const isSavings = (entry: FlowInput, rule: SavingsRule) =>
  savingsDestination(entry, rule) !== null;

/** Os quatro fluxos do mês. Aporte é a saída guardada; resgate, a entrada de dinheiro que já era guardado. */
export type EntryFlow = "receita" | "despesa" | "aporte" | "resgate";

export function entryFlow(entry: FlowInput & { kind: EntryKind }, rule: SavingsRule): EntryFlow {
  if (!isSavings(entry, rule)) return entry.kind;
  return entry.kind === "despesa" ? "aporte" : "resgate";
}
