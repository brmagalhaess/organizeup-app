import { describe, expect, it } from "vitest";
import { defaultIncomePlan, type IncomeYearPlan, type VacationPeriod } from "@organizeup/domain";
import { previewReceipts, samePlan } from "./plan-fields";

const period = (month: number, days = 15): VacationPeriod => ({
  month,
  startDay: null,
  days,
  received: false,
});
const plan = (periods: VacationPeriod[]): IncomeYearPlan => ({
  ...defaultIncomePlan(2026, null),
  periods,
});
const receipts = [{ incomeSourceId: "s", month: "2026-10", part: "ferias" }];

describe("prévia das baixas", () => {
  it("N4: casa pelo mês da chave, não pela posição", () => {
    // Outubro recebido saiu: novembro virou o 1º período, e não está pago.
    const preview = previewReceipts(
      "s",
      plan([period(10), period(11)]),
      plan([period(11)]),
      receipts,
    );
    expect(preview.parts).toEqual([]);
    expect(preview.orphans).toEqual(["2026-10"]);
  });

  it("período movido leva a baixa, como vai ser salvo", () => {
    const preview = previewReceipts("s", plan([period(10)]), plan([period(12)]), receipts);
    expect(preview.parts).toEqual(["ferias"]);
    expect(preview.orphans).toEqual([]);
    expect(preview.plan.periods[0]?.keyMonth).toBe(10);
  });

  it("não trata mês com outra renda", () => {
    const preview = previewReceipts("outra", plan([period(10)]), plan([period(10)]), receipts);
    expect(preview.parts).toEqual([]);
  });

  it("samePlan ignora a ordem dos períodos", () => {
    expect(samePlan(plan([period(3), period(9)]), plan([period(9), period(3)]))).toBe(true);
  });
});
