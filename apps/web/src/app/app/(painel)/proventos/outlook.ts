import "server-only";
import { dividendPlanInputs } from "@organizeup/agents";
import { dividends, householdTimezone, withHousehold, type TenantContext } from "@organizeup/db";
import {
  addMonths,
  forecastDividends,
  money,
  planDividendRetirement,
  receivedDividends,
  toDbAmount,
  todayIn,
  yearMonthOf,
} from "@organizeup/domain";
import { tolerateSchemaLag } from "@/lib/suggestions";

const FORECAST_MONTHS = 12;

/** Rendimento da carteira, renda atual × renda alvo e previsão por mês. Null antes da migração. */
export async function loadDividendOutlook(ctx: TenantContext) {
  return tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const today = todayIn(await householdTimezone(tx, ctx.householdId));
        const { input } = await dividendPlanInputs(tx, { today });
        const paid = receivedDividends(await tx.select().from(dividends), today);

        const plan = planDividendRetirement(input);
        // Sem renda alvo o plano para antes do rendimento, mas ele só depende da carteira.
        const yieldPlan =
          plan.status === "sem_dados"
            ? planDividendRetirement({ ...input, targetIncome: "1.00" })
            : plan;

        const from = yearMonthOf(today);
        const forecast = forecastDividends(paid, from, FORECAST_MONTHS);
        const months = Array.from({ length: FORECAST_MONTHS }, (_, index) => {
          const month = addMonths(from, index);
          const amount = forecast
            .filter((row) => row.month === month)
            .reduce((acc, row) => acc.plus(row.amount), money(0));
          return { month, amount: toDbAmount(amount) };
        });

        return {
          currentIncome: toDbAmount(
            input.assets
              .reduce((acc, asset) => acc.plus(asset.dividendsNet12), money(0))
              .dividedBy(12),
          ),
          targetIncome: plan.targetIncome,
          targetBasis: plan.targetBasis,
          coverage: plan.coverage,
          yieldUsed: yieldPlan.yieldUsed,
          yieldBasis: yieldPlan.yieldBasis,
          yieldMonthsBasis: yieldPlan.yieldMonthsBasis,
          forecast: forecast.length === 0 ? [] : months,
        };
      }),
    null,
  );
}
