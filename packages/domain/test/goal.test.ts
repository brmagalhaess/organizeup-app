import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GOAL_RULES, money, planGoals, type GoalInput, type PlanGoalsInput } from "../src";

const goal = (overrides: Partial<GoalInput> & { id: string }): GoalInput => ({
  name: overrides.id,
  targetAmount: "1000.00",
  saved: "0.00",
  desiredMonth: null,
  priority: 3,
  status: "planejando",
  confirmedMonths: [],
  ...overrides,
});

const base: PlanGoalsInput = {
  today: "2026-10-15",
  planDayPassed: false,
  budget: "1500.00",
  goals: [],
};

const sum = (plan: { contributions: Array<{ amount: string }> }) =>
  plan.contributions.reduce((acc, c) => acc.plus(c.amount), money(0)).toFixed(2);

describe("plano das metas", () => {
  it("meta com prazo que cabe divide o que falta pelos meses, inclusive o último", () => {
    // 12.000 de outubro de 2026 a setembro de 2027: 12 meses → 1.000 por mês.
    const [plan] = planGoals({
      ...base,
      goals: [goal({ id: "carro", targetAmount: "12000.00", desiredMonth: "2027-09" })],
    });
    expect(plan).toMatchObject({
      id: "carro",
      status: "juntando",
      start: "2026-10",
      end: "2027-09",
      monthly: "1000.00",
      months: 12,
      onTime: true,
      note: "",
    });
    expect(sum(plan!)).toBe("12000.00");
  });

  it("segue a prioridade e a próxima começa quando a anterior terminar", () => {
    const plans = planGoals({
      ...base,
      goals: [
        goal({ id: "c", priority: 3 }),
        goal({ id: "a", priority: 1, targetAmount: "12000.00", desiredMonth: "2027-09" }),
        goal({ id: "b", priority: 2, targetAmount: "3000.00" }),
      ],
    });
    expect(plans.map((p) => p.id)).toEqual(["a", "b", "c"]);
    // Sobram 500 para "b": 6 meses até março de 2027.
    expect(plans[1]).toMatchObject({ monthly: "500.00", months: 6, end: "2027-03", onTime: null });
    // "c" espera "b" acabar e herda os 500.
    expect(plans[2]).toMatchObject({
      start: "2027-04",
      end: "2027-05",
      monthly: "500.00",
      months: 2,
    });
    expect(plans[2]!.note).toBe("Começa quando b terminar.");
  });

  it("dia de guardar passado e parcela confirmada empurram o início", () => {
    const [passed] = planGoals({ ...base, planDayPassed: true, goals: [goal({ id: "g" })] });
    expect(passed!.start).toBe("2026-11");
    const [confirmed] = planGoals({
      ...base,
      goals: [goal({ id: "g", confirmedMonths: ["2026-10", "2026-11"] })],
    });
    expect(confirmed!.start).toBe("2026-12");
    const [own] = planGoals({ ...base, goals: [goal({ id: "g", planDayPassed: true })] });
    expect(own!.start).toBe("2026-11");
  });

  it("quando não cabe no prazo, usa o que sobra e avisa", () => {
    const [plan] = planGoals({
      ...base,
      budget: "1000.00",
      goals: [goal({ id: "g", targetAmount: "24000.00", desiredMonth: "2027-09" })],
    });
    expect(plan).toMatchObject({ monthly: "1000.00", months: 24, onTime: false, end: "2028-09" });
    expect(plan!.note).toBe(
      "Não cabe no orçamento até setembro de 2027; termina em setembro de 2028.",
    );
  });

  it("data desejada passada vira nova previsão", () => {
    const [plan] = planGoals({
      ...base,
      goals: [goal({ id: "g", targetAmount: "3000.00", desiredMonth: "2026-05" })],
    });
    expect(plan).toMatchObject({ onTime: false, end: "2026-11" });
    expect(plan!.note).toBe("A data desejada já passou; nova previsão: novembro de 2026.");
  });

  it("plano longo demais não gera parcelas", () => {
    const [plan] = planGoals({
      ...base,
      budget: "1000.00",
      goals: [goal({ id: "g", targetAmount: "200000.00" })],
    });
    expect(plan).toMatchObject({
      start: null,
      end: null,
      monthly: null,
      months: 0,
      contributions: [],
    });
    expect(plan!.note).toContain("levaria mais de 10 anos");
    expect(GOAL_RULES.maxMonths).toBe(120);
  });

  it("sem orçamento e sem meta anterior, avisa", () => {
    const [plan] = planGoals({ ...base, budget: "0.00", goals: [goal({ id: "g" })] });
    expect(plan!.monthly).toBeNull();
    expect(plan!.note).toContain("Hoje não sobra orçamento");
  });

  it("meta conquistada ou pausada não recebe parcelas", () => {
    const plans = planGoals({
      ...base,
      goals: [
        goal({ id: "done", saved: "1000.00" }),
        goal({ id: "paused", status: "pausada" }),
        goal({ id: "next" }),
      ],
    });
    expect(plans.find((p) => p.id === "done")).toMatchObject({
      status: "concluida",
      contributions: [],
    });
    expect(plans.find((p) => p.id === "paused")).toMatchObject({
      status: "pausada",
      contributions: [],
    });
    // As duas não consomem orçamento: "next" recebe tudo.
    expect(plans.find((p) => p.id === "next")!.monthly).toBe("1000.00");
  });

  it("o resíduo de centavos vai para a última parcela", () => {
    // 1.000 em 3 meses: 333,34 + 333,34 + 333,32.
    const [plan] = planGoals({
      ...base,
      goals: [goal({ id: "g", desiredMonth: "2026-12" })],
    });
    expect(plan!.contributions.map((c) => c.amount)).toEqual(["333.34", "333.34", "333.32"]);
    expect(sum(plan!)).toBe("1000.00");
  });

  it("invariantes: parcelas somam o que falta, cabem no orçamento e pulam meses confirmados", () => {
    const months = [
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
      "2027-06",
      "2028-01",
    ];
    const goalArb = fc.record({
      id: fc.uuid(),
      targetAmount: fc.integer({ min: 100, max: 5_000_000 }).map((c) => (c / 100).toFixed(2)),
      saved: fc.integer({ min: 0, max: 2_000_000 }).map((c) => (c / 100).toFixed(2)),
      desiredMonth: fc.option(fc.constantFrom(...months), { nil: null }),
      priority: fc.integer({ min: 1, max: 5 }),
      status: fc.constantFrom("planejando" as const, "juntando" as const, "pausada" as const),
      confirmedMonths: fc.uniqueArray(fc.constantFrom(...months.slice(0, 4)), { maxLength: 3 }),
    });
    const input = fc.record({
      planDayPassed: fc.boolean(),
      budget: fc.integer({ min: 0, max: 2_000_000 }).map((c) => (c / 100).toFixed(2)),
      goals: fc.array(goalArb, { maxLength: 6 }),
    });
    fc.assert(
      fc.property(input, (data) => {
        const plans = planGoals({ ...base, ...data });
        const perMonth = new Map<string, ReturnType<typeof money>>();
        for (const plan of plans) {
          const source = data.goals.find((g) => g.id === plan.id)!;
          if (plan.end !== null) {
            const missing = money(source.targetAmount).minus(source.saved);
            expect(sum(plan)).toBe(missing.toFixed(2));
            expect(plan.start! <= plan.end).toBe(true);
            expect(plan.contributions.map((c) => c.month)).toEqual(
              [...plan.contributions.map((c) => c.month)].sort(),
            );
          }
          for (const c of plan.contributions) {
            expect(source.confirmedMonths).not.toContain(c.month);
            perMonth.set(c.month, (perMonth.get(c.month) ?? money(0)).plus(c.amount));
          }
        }
        for (const total of perMonth.values()) expect(total.lte(data.budget)).toBe(true);
      }),
    );
  });
});
