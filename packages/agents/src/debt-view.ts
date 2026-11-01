// Plano de saída das dívidas recalculado a cada leitura. A tela, o assistente e o agente usam este
// mesmo caminho, para dar o mesmo número. Só lê dívida informada: o que veio de um arquivo só chega
// aqui depois da conferência, quando já virou dívida. Rode dentro de withHousehold.
import {
  asc,
  debtInstallments,
  debts,
  eq,
  incomeSources,
  isNull,
  type TenantTx,
} from "@organizeup/db";
import {
  money,
  planDebtPayoff,
  toDbAmount,
  yearMonthOf,
  type DebtPlan,
  type PlanDebt,
} from "@organizeup/domain";
import { currentDividendPlan } from "./retirement-view";

/** Dívidas ativas com parcela em aberto: saldo é a soma da amortização, mínimo é a próxima parcela. */
async function openPlanDebts(tx: TenantTx): Promise<PlanDebt[]> {
  const rows = await tx.select().from(debts).where(eq(debts.archived, false));
  const installments = await tx
    .select()
    .from(debtInstallments)
    .where(isNull(debtInstallments.transactionId))
    .orderBy(asc(debtInstallments.number));
  return rows.flatMap((debt) => {
    const open = installments.filter((row) => row.debtId === debt.id);
    const next = open[0];
    if (!next) return [];
    return [
      {
        id: debt.id,
        name: debt.name,
        system: debt.system,
        balance: toDbAmount(open.reduce((acc, row) => acc.plus(row.principal), money(0))),
        // Em parcela informada os juros já estão embutidos: a taxa só ordena (ADR-0005).
        monthlyRate: debt.system === "manual" ? "0" : debt.monthlyRate,
        rankRate: debt.monthlyRate,
        minimum: next.amount,
        nextDue: next.dueDate,
      },
    ];
  });
}

async function activePayDays(tx: TenantTx, today: string): Promise<number[]> {
  const month = yearMonthOf(today);
  const rows = await tx.select().from(incomeSources);
  return rows
    .filter(
      (source) =>
        source.startMonth <= month && (source.endMonth === null || source.endMonth >= month),
    )
    .map((source) => source.payDay);
}

export interface DebtPlanView {
  /** Null sem dívida em aberto. */
  plan: DebtPlan | null;
  /** Valor extra por mês, `allocation.debt` da divisão do que sobra. */
  extra: string;
}

export async function currentDebtPlan(tx: TenantTx, today: string): Promise<DebtPlanView> {
  const planDebts = await openPlanDebts(tx);
  if (planDebts.length === 0) return { plan: null, extra: "0.00" };
  const { allocation, plan: retirement } = await currentDividendPlan(tx, today);
  return {
    extra: allocation.debt,
    plan: planDebtPayoff({
      today,
      extra: allocation.debt,
      debts: planDebts,
      yieldAnnualPercent: retirement.yieldUsed,
      payDays: await activePayDays(tx, today),
    }),
  };
}
