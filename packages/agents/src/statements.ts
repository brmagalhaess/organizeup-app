// Leituras dos relatórios da família (ADR-0021), usadas pela tela, pelos arquivos para baixar e pelo
// assistente, todos pelo mesmo caminho. Rode dentro de withHousehold.
import {
  and,
  asc,
  desc,
  eq,
  householdSettings,
  householdStatements,
  sql,
  type TenantTx,
} from "@organizeup/db";
import {
  addMonths,
  CURRENCIES,
  yearMonthOf,
  type Currency,
  type ReportKind,
} from "@organizeup/domain";

/**
 * Moeda principal da família. A coluna `main_currency` chega numa migração de outra frente (0033), e
 * `currency` fica presa em real até lá. `to_jsonb` lê a nova se ela existir, sem depender da ordem em
 * que as duas entram. Moeda desconhecida vira real: nunca derruba tela.
 */
export async function householdCurrency(tx: TenantTx, householdId: string): Promise<Currency> {
  const [row] = await tx
    .select({
      currency: sql<string>`coalesce(to_jsonb(household_settings)->>'main_currency', ${householdSettings.currency})`,
    })
    .from(householdSettings)
    .where(eq(householdSettings.householdId, householdId));
  const currency = CURRENCIES.find((item) => item === row?.currency);
  return currency ?? "BRL";
}

/** Períodos que este relatório tem, do mais novo ao mais antigo. */
export async function statementPeriods(tx: TenantTx, kind: ReportKind) {
  return tx
    .select({ period: householdStatements.period, status: householdStatements.status })
    .from(householdStatements)
    .where(eq(householdStatements.kind, kind))
    .orderBy(desc(householdStatements.period));
}

/** Quantos relatórios a família já tem, por tipo: a tela escolhe o que abrir primeiro. */
export async function statementKinds(tx: TenantTx) {
  const rows = await tx
    .selectDistinct({ kind: householdStatements.kind })
    .from(householdStatements)
    .orderBy(asc(householdStatements.kind));
  return rows.map((row) => row.kind);
}

export async function readStatement(tx: TenantTx, kind: ReportKind, period: string) {
  const [row] = await tx
    .select()
    .from(householdStatements)
    .where(and(eq(householdStatements.kind, kind), eq(householdStatements.period, period)));
  return row ?? null;
}

/** O relatório mais novo daquele tipo. */
export async function latestStatement(tx: TenantTx, kind: ReportKind) {
  const [row] = await tx
    .select()
    .from(householdStatements)
    .where(eq(householdStatements.kind, kind))
    .orderBy(desc(householdStatements.period))
    .limit(1);
  return row ?? null;
}

/** Só o período que acabou de fechar ganha o parágrafo: o histórico antigo não gasta modelo. */
export const narrationPeriods = (today: string) => {
  const month = yearMonthOf(today);
  return [addMonths(month, -1), String(Number(month.slice(0, 4)) - 1)];
};
