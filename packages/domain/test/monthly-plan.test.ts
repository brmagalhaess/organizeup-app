import { describe, expect, it } from "vitest";
import {
  monthlyPlan,
  planDividendRetirement,
  type DividendAssetInput,
  type DividendPlanInput,
} from "../src/index";

const asset: DividendAssetInput = {
  id: "f",
  assetClass: "fii",
  value: "100000.00",
  dividendsNet12: "8000.00",
  monthsHeld: 24,
  firstDividendOn: "2024-11-10",
};

const base: DividendPlanInput = {
  today: "2026-10-31",
  targetYear: 2040,
  targetIncome: "6000.00",
  essentialMonthly: "3000.00",
  averageExpenses12: null,
  pensions: [],
  assets: [asset],
  expectedYield: "8",
  dividendGrowth: "0",
  contribution: "500.00",
};

const input = (over = {}) => ({
  base,
  plan: planDividendRetirement(base),
  contribution: "500.00",
  allocation: { reserve: "0.00", debt: "0.00", retirement: "500.00" },
  largestCategory: { name: "Mercado", amount: "2000.00" },
  ...over,
});

describe("plano do mês", () => {
  it("plano incompleto pede para completar", () => {
    const plan = { ...planDividendRetirement(base), status: "sem_dados" as const };
    expect(monthlyPlan(input({ plan })).map((action) => action.kind)).toEqual(["completar"]);
  });

  it("reserva e dívida cara vêm antes de guardar mais, e são três no máximo", () => {
    const actions = monthlyPlan(
      input({ allocation: { reserve: "300.00", debt: "200.00", retirement: "0.00" } }),
    );
    expect(actions.map((action) => action.kind)).toEqual(["reserva", "divida", "guardar"]);
  });

  it("guardar mais mostra quantos anos antecipa", () => {
    const [action] = monthlyPlan(
      input({ allocation: { reserve: "0.00", debt: "0.00", retirement: "2500.00" } }),
    );
    expect(action).toMatchObject({ kind: "guardar", amount: "2000.00" });
    expect(action!.yearsEarlier).toBeGreaterThan(0);
  });

  it("corte na maior categoria é 10% dela", () => {
    const actions = monthlyPlan(input());
    expect(actions.find((action) => action.kind === "gasto")).toMatchObject({
      amount: "200.00",
      category: "Mercado",
    });
  });
});
