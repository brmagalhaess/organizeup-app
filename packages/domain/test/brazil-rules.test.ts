import { describe, expect, it } from "vitest";
import {
  ANYWHERE_INVESTMENT_CLASSES,
  brazilRulesApply,
  investmentClassAllowed,
} from "../src/brazil-rules";
import { suggestAllocation } from "../src/allocation";
import { debtPlanHeadlineMessage } from "../src/debt-plan";
import { plainIncomes, monthlyNet, type FiscalTable } from "../src/income";
import { moneyValue } from "../src/messages";

describe("regras brasileiras", () => {
  it("valem só com moeda principal em real", () => {
    expect(brazilRulesApply("BRL")).toBe(true);
    expect(brazilRulesApply("USD")).toBe(false);
    expect(brazilRulesApply("EUR")).toBe(false);
  });

  it("em real, toda classe de investimento vale", () => {
    for (const assetClass of ["acao", "fii", "etf_bdr", ...ANYWHERE_INVESTMENT_CLASSES])
      expect(investmentClassAllowed(assetClass, "BRL")).toBe(true);
  });

  it("fora do real, só as classes de valor informado", () => {
    for (const assetClass of ["acao", "fii", "etf_bdr"])
      expect(investmentClassAllowed(assetClass, "USD")).toBe(false);
    for (const assetClass of ANYWHERE_INVESTMENT_CLASSES)
      expect(investmentClassAllowed(assetClass, "EUR")).toBe(true);
  });
});

describe("renda fora das regras brasileiras", () => {
  const source = {
    id: "r",
    name: "Empresa",
    kind: "clt" as const,
    amount: "5000.00",
    isGross: true,
    dependents: 0,
    pensionAmount: "0.00",
    otherDiscounts: "0.00",
    vacationMonth: null,
    payDay: 5,
    startMonth: "2026-01",
    endMonth: null,
    categoryId: "c",
    accountId: "a",
  };

  it("em real, nada muda", () => {
    expect(plainIncomes([source], "BRL")[0]).toBe(source);
  });

  it("fora do real, o valor é o líquido, sem tabela fiscal", () => {
    const [plain] = plainIncomes([source], "USD");
    expect(plain!.isGross).toBe(false);
    expect(monthlyNet(plain!, [] as FiscalTable[], "2026-10")).toBe("5000.00");
  });
});

describe("valor de mensagem", () => {
  it("em real, a linha continua igual", () => {
    expect(moneyValue("10.00")).toEqual({ money: "10.00" });
    expect(moneyValue("10.00", "BRL")).toEqual({ money: "10.00" });
  });

  it("fora do real, leva a moeda", () => {
    expect(moneyValue("10.00", "USD")).toEqual({ money: "10.00", currency: "USD" });
  });
});

describe("notas em português", () => {
  it("saem na moeda da família", () => {
    const allocation = suggestAllocation({
      available: "1000.00",
      reserveMissing: "5000.00",
      expensiveDebtBalance: "0.00",
      retirementRequired: null,
      confirmedTripsMonthly: "0.00",
      currency: "USD",
    });
    expect(allocation.notes.join(" ")).toContain("US$");
    expect(allocation.notes.join(" ")).not.toContain("R$");
  });

  it("a manchete do plano das dívidas leva a moeda nos valores", () => {
    const strategy = { payoffMonth: "2027-01", saved: "100.00", attack: [], thisMonth: [] };
    const plan = { recommended: "avalanche", avalanche: strategy, snowball: strategy };
    const message = debtPlanHeadlineMessage(plan as never, "EUR");
    expect(message.params?.["saved"]).toEqual({ money: "100.00", currency: "EUR" });
  });
});
