import { describe, expect, it } from "vitest";
import { reserveStatus } from "@organizeup/domain";
import { reserveNextStep, type NextStepInput } from "./next-step";

const status = reserveStatus("9000.00", "3000.00", 6);
const base: NextStepInput = {
  hasBaseline: true,
  hasExpenses: true,
  accounts: [{ name: "Poupança", selected: true }],
  status,
  contribution: "2000.00",
};

describe("reserveNextStep", () => {
  it("sem base de gastos, leva a lançamentos ou às categorias", () => {
    const zero = reserveStatus("0.00", "0.00", 6);
    expect(
      reserveNextStep({ ...base, hasBaseline: false, hasExpenses: false, status: zero }).action
        .href,
    ).toBe("/app/lancamentos");
    expect(reserveNextStep({ ...base, hasBaseline: false, status: zero }).action.href).toBe(
      "/app/categorias",
    );
  });

  it("sem conta, pede para criar ou marcar", () => {
    const zero = reserveStatus("0.00", "3000.00", 6);
    expect(reserveNextStep({ ...base, accounts: [], status: zero }).action.href).toBe(
      "/app/contas",
    );
    expect(
      reserveNextStep({
        ...base,
        accounts: [{ name: "Poupança", selected: false }],
        status: zero,
      }).action.href,
    ).toBe("#quanto-tenho");
  });

  it("sem valor mensal, pede para definir", () => {
    expect(reserveNextStep({ ...base, contribution: null }).action.href).toBe("#quanto-falta");
  });

  it("nunca pede para guardar mais do que falta", () => {
    expect(reserveNextStep(base).title).toMatch(/Guarde R\$\s2\.000,00 este mês/);
    expect(reserveNextStep({ ...base, contribution: "50000.00" }).title).toMatch(
      /Guarde R\$\s9\.000,00 este mês/,
    );
  });

  it("reserva completa fala do excedente sem citar investimento", () => {
    const step = reserveNextStep({ ...base, status: reserveStatus("20000.00", "3000.00", 6) });
    expect(step.title).toBe("Sua reserva está completa");
    expect(step.text).toMatch(/R\$\s2\.000,00 além do necessário/);
    expect(step.action.writes).toBe(false);
  });
});
