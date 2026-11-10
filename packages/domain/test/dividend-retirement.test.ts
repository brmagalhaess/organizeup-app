import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  accumulationFactor,
  forecastDividends,
  money,
  monthlyRate,
  planDividendRetirement,
  type DividendAssetInput,
  type DividendInput,
  type DividendPlanInput,
} from "../src";

// Fixture do ADR-0015: rendimento 6% a.a. ⇔ 0,4868% a.m. ((1,06)^(1/12) − 1); renda alvo 6.000,
// INSS 1.500 → faltam 4.500 por mês → carteira 4.500 × 12 / 0,06 = 900.000.
const fii: DividendAssetInput = {
  id: "f",
  assetClass: "fii",
  value: "100000.00",
  dividendsNet12: "6000.00",
  monthsHeld: 24,
  firstDividendOn: "2024-11-10",
};

// `formatBRL` separa "R$" do número com espaço inseparável.
const plain = (notes: string[]) => notes.join(" ").split(String.fromCharCode(160)).join(" ");

const base: DividendPlanInput = {
  today: "2026-10-31",
  targetYear: 2036,
  targetIncome: "6000.00",
  essentialMonthly: "3000.00",
  averageExpenses12: null,
  pensions: [{ amount: "1500.00", ageAtTarget: 65, retirementAge: 65 }],
  assets: [fii],
  expectedYield: null,
  dividendGrowth: "0",
  contribution: "0",
};

describe("aposentadoria por proventos", () => {
  it("6% ao ano é 0,4868% ao mês", () => {
    expect(monthlyRate("6").times(100).toNumber()).toBeCloseTo(0.4868, 4);
  });

  it("carteira necessária é a renda que falta dividida pelo rendimento", () => {
    const plan = planDividendRetirement(base);
    expect(plan).toMatchObject({
      status: "ok",
      targetIncome: "6000.00",
      targetBasis: "informado",
      otherIncome: "1500.00",
      incomeGap: "4500.00",
      currentIncome: "500.00",
      coverage: 11,
      yieldUsed: "6",
      yieldBasis: "observado_12m",
      incomeBase: "100000.00",
      otherBase: "0.00",
      requiredPortfolio: "900000.00",
      portfolioGap: "800000.00",
      monthsToTarget: 111, // de 2026-10 até 2036-01
    });
    expect(plan.series[0]).toEqual({ year: 2026, value: "100000.00", income: "500.00" });
  });

  it("o aporte exigido fecha a carteira no ano alvo", () => {
    const plan = planDividendRetirement(base);
    // Quanto já existe cresce ao rendimento; o resto vem da série uniforme de aportes.
    const rate = monthlyRate("6");
    const grown = money("100000").times(rate.plus(1).pow(111));
    const expected = money("900000").minus(grown).dividedBy(accumulationFactor(rate, 111));
    expect(money(plan.requiredContribution!).toNumber()).toBeCloseTo(expected.toNumber(), 0);
    const funded = planDividendRetirement({ ...base, contribution: plan.requiredContribution! });
    expect(funded.yearWithContribution).toBe(2036);
    expect(money(funded.series.find((p) => p.year === 2036)!.value).gte("900000")).toBe(true);
    expect(money(funded.projectedIncomeAtTarget!).gte("4500")).toBe(true);
  });

  it("com o aporte atual diz em que ano fecha", () => {
    const plan = planDividendRetirement(base);
    expect(plan.yearWithContribution).toBeGreaterThan(2036);
    expect(plan.notes.join(" ")).toContain(
      `Com o que você guarda hoje a carteira fecha em ${plan.yearWithContribution}`,
    );
  });

  it("deriva a renda alvo do gasto quando a família não informou", () => {
    const essential = planDividendRetirement({ ...base, targetIncome: null });
    expect(essential).toMatchObject({ targetIncome: "3600.00", targetBasis: "essencial_120" });
    const average = planDividendRetirement({
      ...base,
      targetIncome: null,
      averageExpenses12: "4000.00",
    });
    expect(average).toMatchObject({ targetIncome: "4000.00", targetBasis: "gasto_medio" });
    const none = planDividendRetirement({ ...base, targetIncome: null, essentialMonthly: "0" });
    expect(none.status).toBe("sem_dados");
    expect(none.requiredPortfolio).toBeNull();
  });

  it("pensão que entra depois do ano alvo não abate a renda e ganha nota", () => {
    const plan = planDividendRetirement({
      ...base,
      pensions: [{ amount: "1500.00", ageAtTarget: 60, retirementAge: 65 }],
    });
    expect(plan.otherIncome).toBe("0.00");
    expect(plan.incomeGap).toBe("6000.00");
    expect(plan.pensionsLater).toEqual([{ amount: "1500.00", fromYear: 2041 }]);
    expect(plain(plan.notes.slice(0, 1))).toBe("R$ 1.500,00 de INSS ou pensão entra só em 2041.");
  });

  it("renda já coberta por pensões não exige carteira", () => {
    const plan = planDividendRetirement({
      ...base,
      pensions: [{ amount: "7000.00", ageAtTarget: 65, retirementAge: 65 }],
    });
    expect(plan).toMatchObject({
      incomeGap: "0.00",
      coverage: 100,
      requiredPortfolio: "0.00",
      requiredContribution: "0.00",
      yearWithContribution: 2026,
    });
  });

  it("anualiza proventos de ativo com menos de 12 meses e avisa", () => {
    // 300 em 6 meses → 600 ao ano sobre 10.000 = 6%.
    const plan = planDividendRetirement({
      ...base,
      assets: [{ ...fii, value: "10000.00", dividendsNet12: "300.00", monthsHeld: 6 }],
    });
    expect(plan).toMatchObject({
      yieldUsed: "6",
      yieldBasis: "observado_anualizado",
      yieldMonthsBasis: 6,
    });
    expect(plan.notes).toContain("Rendimento baseado em 6 meses de proventos.");
  });

  it("ativo com menos de 3 meses fica fora da base e usa o informado", () => {
    const plan = planDividendRetirement({
      ...base,
      assets: [{ ...fii, monthsHeld: 2 }],
      expectedYield: "8",
    });
    expect(plan).toMatchObject({
      yieldUsed: "8",
      yieldBasis: "informado",
      incomeBase: "100000.00",
    });
    expect(plan.requiredPortfolio).toBe("675000.00");
  });

  it("rendimento fora de 1% a 20% é suspeito", () => {
    const suspicious = { ...fii, dividendsNet12: "50000.00" };
    const without = planDividendRetirement({ ...base, assets: [suspicious] });
    expect(without).toMatchObject({ status: "sem_yield", yieldBasis: "suspeito", yieldUsed: null });
    expect(without.observedYield).toBe("50");
    expect(without.suspiciousAssets).toEqual(["f"]);
    const informed = planDividendRetirement({ ...base, assets: [suspicious], expectedYield: "6" });
    expect(informed).toMatchObject({ status: "ok", yieldUsed: "6", yieldBasis: "suspeito" });
  });

  it("outros investimentos contam na carteira com a premissa de migrar", () => {
    const plan = planDividendRetirement({
      ...base,
      assets: [
        fii,
        {
          id: "r",
          assetClass: "renda_fixa",
          value: "50000.00",
          dividendsNet12: "0",
          monthsHeld: 30,
          firstDividendOn: null,
        },
      ],
    });
    expect(plan).toMatchObject({
      incomeBase: "100000.00",
      otherBase: "50000.00",
      portfolioGap: "750000.00",
    });
    expect(plain(plan.notes)).toContain("R$ 50.000,00");
  });

  it("sem ano alvo calcula a carteira mas não o aporte", () => {
    const plan = planDividendRetirement({ ...base, targetYear: null });
    expect(plan).toMatchObject({
      status: "sem_ano",
      requiredPortfolio: "900000.00",
      monthsToTarget: null,
      requiredContribution: null,
      projectedIncomeAtTarget: null,
    });
    expect(plan.yearWithContribution).not.toBeNull();
  });

  it("ano alvo que já passou compara o que há com o necessário", () => {
    const plan = planDividendRetirement({ ...base, targetYear: 2026 });
    expect(plan).toMatchObject({ monthsToTarget: 0, requiredContribution: null });
    expect(plan.projectedIncomeAtTarget).toBe("500.00");
  });

  it("sem proventos nem rendimento informado pede o dado", () => {
    const plan = planDividendRetirement({ ...base, assets: [] });
    expect(plan.status).toBe("sem_yield");
    expect(plan.coverage).toBe(0);
  });

  it("invariante: o aporte exigido fecha até o ano alvo", () => {
    const scenario = fc.record({
      income: fc.integer({ min: 2000, max: 20000 }),
      yieldPercent: fc.integer({ min: 2, max: 12 }),
      years: fc.integer({ min: 2, max: 30 }),
      growth: fc.integer({ min: 0, max: 3 }),
      saved: fc.integer({ min: 0, max: 300000 }),
    });
    fc.assert(
      fc.property(scenario, ({ income, yieldPercent, years, growth, saved }) => {
        const input: DividendPlanInput = {
          ...base,
          targetYear: 2026 + years,
          targetIncome: String(income),
          pensions: [],
          assets: [{ ...fii, value: String(saved), dividendsNet12: "0", monthsHeld: 2 }],
          expectedYield: String(yieldPercent),
          dividendGrowth: String(growth),
        };
        const plan = planDividendRetirement(input);
        expect(plan.requiredContribution).not.toBeNull();
        const funded = planDividendRetirement({
          ...input,
          contribution: plan.requiredContribution!,
        });
        expect(funded.yearWithContribution).not.toBeNull();
        expect(funded.yearWithContribution!).toBeLessThanOrEqual(2026 + years);
      }),
      { numRuns: 30 },
    );
  });

  it("invariante: a carteira necessária cresce quando o rendimento cai", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1900 }),
        fc.integer({ min: 1, max: 100 }),
        (lowBasis, delta) => {
          const low = (lowBasis / 100).toFixed(2);
          const high = ((lowBasis + delta) / 100).toFixed(2);
          const at = (expectedYield: string) =>
            planDividendRetirement({ ...base, assets: [], expectedYield }).requiredPortfolio!;
          expect(money(at(low)).gt(at(high))).toBe(true);
        },
      ),
      // Mesmo numRuns da invariante acima (linha ~240): 30 amostras bastam
      // para a propriedade e evitam timeout em máquina sob carga.
      { numRuns: 30 },
    );
  });

  it("invariante: a cobertura nunca é negativa", () => {
    const asset = fc.record({
      value: fc.integer({ min: 0, max: 1_000_000 }).map(String),
      dividendsNet12: fc.integer({ min: 0, max: 100_000 }).map(String),
      monthsHeld: fc.integer({ min: 0, max: 36 }),
    });
    fc.assert(
      fc.property(
        fc.array(asset, { maxLength: 6 }),
        fc.integer({ min: 0, max: 10000 }),
        (assets, pension) => {
          const plan = planDividendRetirement({
            ...base,
            pensions: [{ amount: String(pension), ageAtTarget: 65, retirementAge: 65 }],
            assets: assets.map((a, i) => ({ ...fii, ...a, id: String(i) })),
            expectedYield: "6",
          });
          expect(plan.coverage).toBeGreaterThanOrEqual(0);
          expect(plan.coverage).toBeLessThanOrEqual(999);
        },
      ),
    );
  });
});

describe("proventos previstos", () => {
  const row = (investmentId: string, paidOn: string, gross: string): DividendInput => ({
    investmentId,
    kind: "dividendo",
    paidOn,
    gross,
    withheld: "0",
  });
  // "a" pagou em 10 dos últimos 12 meses antes de 2026-11; "b" pagou uma vez em dezembro de 2025;
  // "c" só tem histórico antigo.
  const rows = [
    ...Array.from({ length: 10 }, (_, i) =>
      row("a", `2026-${String(i + 1).padStart(2, "0")}-15`, "10"),
    ),
    row("b", "2025-12-20", "50"),
    row("c", "2024-06-10", "99"),
  ];

  it("pagador mensal recebe a média em todo mês", () => {
    const forecast = forecastDividends(rows, "2026-11");
    const a = forecast.filter((f) => f.investmentId === "a");
    expect(a).toHaveLength(12);
    expect(a[0]).toEqual({
      investmentId: "a",
      month: "2026-11",
      amount: "8.33",
      basis: "mensal_12m",
    });
  });

  it("pagador esporádico repete o mesmo mês do ano anterior", () => {
    const b = forecastDividends(rows, "2026-11").filter((f) => f.investmentId === "b");
    expect(b).toEqual([
      { investmentId: "b", month: "2026-12", amount: "50.00", basis: "mesmo_mes_ano_passado" },
    ]);
  });

  it("sem histórico recente não inventa", () => {
    expect(forecastDividends(rows, "2026-11").some((f) => f.investmentId === "c")).toBe(false);
    expect(forecastDividends([], "2026-11")).toEqual([]);
  });

  it("respeita a quantidade de meses pedida", () => {
    expect(
      forecastDividends(rows, "2026-11", 3).filter((f) => f.investmentId === "a"),
    ).toHaveLength(3);
  });
});
