import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { reserveStatus } from "@organizeup/domain";
import ptBR from "../../../../../messages/pt-BR.json";
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
    expect(reserveNextStep(base)).toMatchObject({
      key: "saveOne",
      amount: "2000.00",
      place: "Poupança",
    });
    expect(reserveNextStep({ ...base, contribution: "50000.00" }).amount).toBe("9000.00");
  });

  it("com mais de uma conta marcada, não cita o nome de nenhuma", () => {
    const step = reserveNextStep({
      ...base,
      accounts: [
        { name: "Poupança", selected: true },
        { name: "Corrente", selected: true },
      ],
    });
    expect(step.key).toBe("saveMany");
    expect(step.place).toBeUndefined();
  });

  it("reserva completa fala do excedente sem citar investimento", () => {
    const step = reserveNextStep({ ...base, status: reserveStatus("20000.00", "3000.00", 6) });
    expect(step.key).toBe("completeExtra");
    expect(step.amount).toBe("2000.00");
    expect(step.action.writes).toBe(false);
    expect(
      reserveNextStep({ ...base, status: reserveStatus("18000.00", "3000.00", 6) }),
    ).toMatchObject({ key: "complete", action: { href: "/app/metas", writes: false } });
  });

  it("o texto em português continua o mesmo", () => {
    const t = createTranslator({ locale: "pt-BR", messages: ptBR, namespace: "reserva.nextStep" });
    expect(t("saveOne.title", { amount: "R$ 2.000,00" })).toBe("Guarde R$ 2.000,00 este mês");
    expect(t("completeExtra.title")).toBe("Sua reserva está completa");
    expect(t("completeExtra.text", { amount: "R$ 2.000,00" })).toContain(
      "R$ 2.000,00 além do necessário",
    );
  });
});
