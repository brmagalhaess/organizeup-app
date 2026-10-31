import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  accumulationFactor,
  annuityFactor,
  money,
  monthlyRate,
  planTrip,
  projectRetirement,
  type RetirementInput,
} from "../src";

// (1,01^12 − 1) em % ao ano: dá exatamente 1% ao mês, a taxa das tabelas de matemática financeira.
const onePercentMonthly = "12.682503013196972";

const base: RetirementInput = {
  ageMonths: 40 * 12,
  targetAge: 41,
  lifeExpectancy: 42,
  targetIncome: "1000",
  otherIncome: "0",
  saved: "0",
  monthlyContribution: "0",
  returnBefore: onePercentMonthly,
  returnAfter: onePercentMonthly,
};

describe("fatores financeiros", () => {
  it("taxa mensal, acumulação e anuidade batem com as tabelas", () => {
    const rate = monthlyRate(onePercentMonthly);
    expect(rate.times(100).toNumber()).toBeCloseTo(1, 8);
    // Tabelas de matemática financeira a 1% a.m.: FAC(12) = 12,6825; FVA(12) = 11,25508.
    expect(accumulationFactor(rate, 12).toNumber()).toBeCloseTo(12.6825, 3);
    expect(annuityFactor(rate, 12).toNumber()).toBeCloseTo(11.25508, 4);
    expect(accumulationFactor(money(0), 12).toNumber()).toBe(12);
  });
});

describe("aposentadoria", () => {
  it("capital necessário bate com o valor presente de série uniforme", () => {
    // 12 parcelas de R$ 1.000 a 1% ao mês valem R$ 11.255,08 (fator 11,25508).
    expect(money(projectRetirement(base).needed).toNumber()).toBeCloseTo(11255.08, 1);
  });

  it("aporte acumula como série uniforme", () => {
    // R$ 1.000 por 12 meses a 1% ao mês somam R$ 12.682,50.
    const result = projectRetirement({ ...base, monthlyContribution: "1000" });
    expect(money(result.projected).toNumber()).toBeCloseTo(12682.5, 1);
  });

  it("guardado rende até parar", () => {
    const result = projectRetirement({ ...base, saved: "10000" });
    expect(money(result.projected).toNumber()).toBeCloseTo(11268.25, 1);
  });

  it("INSS e outras rendas reduzem o que sai do patrimônio", () => {
    const result = projectRetirement({ ...base, otherIncome: "600" });
    expect(result.incomeGap).toBe("400.00");
    expect(money(result.needed).toNumber()).toBeCloseTo(4502.03, 1);
  });

  it("renda já coberta não exige patrimônio", () => {
    const result = projectRetirement({ ...base, otherIncome: "1200" });
    expect(result).toMatchObject({ needed: "0.00", percent: 100, requiredContribution: "0.00" });
    expect(result.runsOutAtAge).toBeNull();
  });

  it("sem retorno real, a conta é simples", () => {
    const result = projectRetirement({
      ...base,
      returnBefore: "0",
      returnAfter: "0",
      monthlyContribution: "100",
    });
    expect(result.needed).toBe("12000.00");
    expect(result.projected).toBe("1200.00");
    expect(result.requiredContribution).toBe("1000.00");
    expect(result.percent).toBe(10);
    expect(result.runsOutAtAge).toBe(41);
  });

  it("aporte exigido fecha a conta e o dinheiro dura até o fim", () => {
    const scenario = fc.record({
      age: fc.integer({ min: 25, max: 60 }),
      working: fc.integer({ min: 1, max: 35 }),
      retired: fc.integer({ min: 5, max: 35 }),
      income: fc.integer({ min: 1000, max: 30000 }),
      saved: fc.integer({ min: 0, max: 50000 }),
      returns: fc.integer({ min: 1, max: 8 }),
    });
    fc.assert(
      fc.property(scenario, ({ age, working, retired, income, saved, returns }) => {
        const input = {
          ...base,
          ageMonths: age * 12,
          targetAge: age + working,
          lifeExpectancy: age + working + retired,
          targetIncome: String(income),
          saved: String(saved),
          returnBefore: String(returns),
          returnAfter: String(returns),
        };
        const required = projectRetirement(input).requiredContribution!;
        const plan = projectRetirement({ ...input, monthlyContribution: required });
        expect(plan.percent).toBeGreaterThanOrEqual(99);
      }),
      { numRuns: 30 },
    );
  });

  it("mostra quando o dinheiro acaba e a renda que o plano sustenta", () => {
    const short = projectRetirement({
      ...base,
      lifeExpectancy: 45,
      returnBefore: "0",
      returnAfter: "0",
      saved: "6000",
    });
    expect(short.runsOutAtAge).toBe(41);
    expect(short.sustainableIncome).toBe("125.00");
  });

  it("quem já parou compara o guardado com o necessário", () => {
    const result = projectRetirement({
      ...base,
      ageMonths: 41 * 12,
      returnAfter: "0",
      saved: "3000",
    });
    expect(result.monthsToRetire).toBe(0);
    expect(result.requiredContribution).toBeNull();
    expect(result.percent).toBe(25);
  });

  it("gráfico tem uma posição por ano", () => {
    const series = projectRetirement({ ...base, ageMonths: 40 * 12 + 3 }).series;
    expect(series.map((point) => point.age)).toEqual([40, 41, 42]);
  });
});

describe("viagens", () => {
  const costs = [
    { amount: "2000", perPerson: true },
    { amount: "3000", perPerson: false },
  ];

  it("soma custos por pessoa e da viagem toda", () => {
    const plan = planTrip(
      { startOn: "2027-01-15", saved: "1000", travelers: 3, costs },
      "2026-10-30",
    );
    expect(plan).toMatchObject({
      total: "9000.00",
      perTraveler: "3000.00",
      missing: "8000.00",
      percent: 11,
      monthsLeft: 3,
      monthly: "2666.67",
      past: false,
    });
  });

  it("no mês da viagem, falta guardar tudo de uma vez", () => {
    const plan = planTrip(
      { startOn: "2026-10-31", saved: "0", travelers: 1, costs: [costs[1]!] },
      "2026-10-30",
    );
    expect(plan).toMatchObject({ monthsLeft: 0, monthly: "3000.00" });
  });

  it("viagem paga e viagem passada não pedem aporte", () => {
    const paid = planTrip(
      { startOn: "2027-01-15", saved: "9999", travelers: 1, costs },
      "2026-10-30",
    );
    expect(paid).toMatchObject({ missing: "0.00", monthly: "0.00", percent: 100 });
    const past = planTrip({ startOn: "2026-01-15", saved: "0", travelers: 1, costs }, "2026-10-30");
    expect(past).toMatchObject({ past: true, monthly: null });
  });
});
