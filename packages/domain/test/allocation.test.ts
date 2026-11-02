import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ALLOCATION_RULES,
  isExpensiveDebt,
  money,
  suggestAllocation,
  type AllocationInput,
} from "../src";

// Percentuais do ADR-0015: 50% reserva, 70% dívidas caras, 70% aposentadoria, 50/50 metas/viagens.
const base: AllocationInput = {
  available: "1000.00",
  reserveMissing: "2000.00",
  expensiveDebtBalance: "100.00",
  retirementRequired: "1000.00",
  confirmedTripsMonthly: "20.00",
};

const cents = (min: number, max: number) =>
  fc.integer({ min, max }).map((c) => (c / 100).toFixed(2));
// `formatBRL` separa "R$" do número com espaço inseparável.
const plain = (notes: string[]) => notes.join(" ").split(String.fromCharCode(160)).join(" ");

describe("divisão do excedente", () => {
  it("segue a ordem reserva, dívidas, aposentadoria, metas e viagens", () => {
    // 1000 → reserva 500 (metade); resta 500 → dívida 100 (cabe inteira); resta 400 →
    // aposentadoria 280 (70%); resta 120 → metas 60, viagens 60 − 20 confirmadas = 40.
    const result = suggestAllocation(base);
    expect(result).toMatchObject({
      reserve: "500.00",
      debt: "100.00",
      retirement: "280.00",
      alreadyInvesting: "0.00",
      alreadySavingForGoals: "0.00",
      goalsBudget: "60.00",
      tripsBudget: "40.00",
      tripsCommitted: "20.00",
      shortfall: "0.00",
    });
    expect(plain(result.notes)).toContain("menos que os R$ 1.000,00 necessários");
  });

  it("sem plano de aposentadoria não guarda para ela e avisa", () => {
    const result = suggestAllocation({ ...base, retirementRequired: null });
    expect(result.retirement).toBe("0.00");
    expect(result.goalsBudget).toBe("200.00");
    expect(result.notes).toContain(
      "Complete o plano de aposentadoria para receber quanto guardar.",
    );
  });

  it("viagens confirmadas acima do que sobra viram falta", () => {
    const result = suggestAllocation({ ...base, confirmedTripsMonthly: "100.00" });
    expect(result).toMatchObject({
      tripsBudget: "0.00",
      tripsCommitted: "60.00",
      shortfall: "40.00",
    });
    expect(plain(result.notes)).toContain("R$ 40,00 por mês a mais");
  });

  it("sem excedente tudo é zero", () => {
    const result = suggestAllocation({ ...base, available: "0.00", surplusMonths: 6 });
    expect(result).toMatchObject({
      reserve: "0.00",
      debt: "0.00",
      retirement: "0.00",
      alreadyInvesting: "0.00",
      alreadySavingForGoals: "0.00",
      goalsBudget: "0.00",
      tripsBudget: "0.00",
      shortfall: "20.00",
    });
    expect(result.notes[0]).toContain("nos últimos 6 meses");
  });

  it("as partes somam exatamente o disponível e nada é negativo", () => {
    const input = fc.record({
      available: cents(0, 5_000_000),
      reserveMissing: cents(0, 10_000_000),
      expensiveDebtBalance: cents(0, 10_000_000),
      retirementRequired: fc.option(cents(0, 5_000_000), { nil: null }),
      confirmedTripsMonthly: cents(0, 500_000),
    });
    fc.assert(
      fc.property(input, (data) => {
        const result = suggestAllocation(data);
        const parts = [
          result.reserve,
          result.debt,
          result.retirement,
          result.goalsBudget,
          result.tripsBudget,
          result.tripsCommitted,
        ];
        for (const part of [...parts, result.shortfall]) expect(money(part).gte(0)).toBe(true);
        const sum = parts.reduce((acc, part) => acc.plus(part), money(0));
        expect(sum.toFixed(2)).toBe(data.available);
        if (data.retirementRequired === null) expect(result.retirement).toBe("0.00");
      }),
    );
  });

  it("é ponto fixo: a saída de ontem como entrada dá a mesma saída", () => {
    const input = fc.record({
      available: cents(0, 5_000_000),
      reserveMissing: cents(0, 10_000_000),
      expensiveDebtBalance: cents(0, 10_000_000),
      retirementRequired: fc.option(cents(0, 5_000_000), { nil: null }),
      confirmedTripsMonthly: cents(0, 500_000),
    });
    fc.assert(
      fc.property(input, (data) => {
        const first = suggestAllocation(data);
        const again = suggestAllocation({
          ...data,
          reserveMissing: first.reserve,
          expensiveDebtBalance: first.debt,
          retirementRequired: data.retirementRequired === null ? null : first.retirement,
        });
        expect(again).toMatchObject({
          reserve: first.reserve,
          debt: first.debt,
          retirement: first.retirement,
          goalsBudget: first.goalsBudget,
          tripsBudget: first.tripsBudget,
          shortfall: first.shortfall,
        });
      }),
    );
  });
});

describe("dívida cara", () => {
  it("compara com 1% ao mês e com o rendimento da carteira", () => {
    expect(ALLOCATION_RULES.expensiveDebtMonthlyRate).toBe("1.00");
    expect(isExpensiveDebt("1.50", null)).toBe(true);
    expect(isExpensiveDebt("0.80", null)).toBe(false);
    // 6% ao ano ⇔ 0,4868% ao mês: 0,60% já é mais caro que investir.
    expect(isExpensiveDebt("0.60", "6")).toBe(true);
    expect(isExpensiveDebt("0.40", "6")).toBe(false);
  });
});
