// Plano do mês (docs/specs/assistente-ia.md, §6): junta o plano por proventos, a divisão do que sobra e
// o maior gasto do último mês fechado. Usado pela tela e pelo assistente. Só lê.
import {
  and,
  categories,
  desc,
  eq,
  gte,
  lte,
  sql,
  transactions,
  type TenantTx,
} from "@organizeup/db";
import { addMonths, monthBounds, monthlyPlan, toDbAmount, yearMonthOf } from "@organizeup/domain";
import { currentDividendPlan } from "./retirement-view";

async function largestCategory(tx: TenantTx, today: string) {
  const { first, last } = monthBounds(addMonths(yearMonthOf(today), -1));
  const total = sql<string>`sum(${transactions.amount})`;
  const [row] = await tx
    .select({ name: categories.name, amount: total })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.kind, "despesa"),
        gte(transactions.occurredOn, first),
        lte(transactions.occurredOn, last),
      ),
    )
    .groupBy(categories.name)
    .orderBy(desc(total))
    .limit(1);
  return row ? { name: row.name, amount: toDbAmount(row.amount) } : null;
}

export async function monthlyPlanView(tx: TenantTx, today: string) {
  const { plan, planData, contribution, allocation } = await currentDividendPlan(tx, today);
  const actions = monthlyPlan({
    base: planData.input,
    plan,
    contribution,
    allocation,
    largestCategory: await largestCategory(tx, today),
  });
  return { actions, contribution, targetYear: planData.input.targetYear, plan };
}
