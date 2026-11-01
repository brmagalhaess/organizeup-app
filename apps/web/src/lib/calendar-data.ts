import "server-only";
import { calendarMonth } from "@organizeup/agents";
import { householdTimezone, withHousehold, type TenantContext } from "@organizeup/db";
import { isYearMonth, todayIn, yearMonthOf } from "@organizeup/domain";

export async function loadCalendar(ctx: TenantContext, requested?: string | null) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const month = requested && isYearMonth(requested) ? requested : yearMonthOf(today);
    return calendarMonth(tx, { today, month });
  });
}
