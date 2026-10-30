import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  essentialBaseline,
  monthsToReserve,
  reserveStatus,
  summarizeNetWorth,
  type NetWorthInput,
} from "../src/wealth";

describe("gasto essencial de referência", () => {
  it("o valor informado tem prioridade", () => {
    expect(essentialBaseline(["3000.00"], "100.00", "4500.00")).toEqual({
      monthly: "4500.00",
      basis: "informado",
      months: 0,
    });
  });

  it("faz a média só dos meses fechados com gasto", () => {
    expect(essentialBaseline(["3000.00", "0.00", "4000.00"], "100.00", null)).toEqual({
      monthly: "3500.00",
      basis: "media",
      months: 2,
    });
  });

  it("quem acabou de começar usa o mês atual", () => {
    expect(essentialBaseline(["0.00"], "2800.00", null)).toEqual({
      monthly: "2800.00",
      basis: "mes_atual",
      months: 1,
    });
  });

  it("sem dados, avisa", () => {
    expect(essentialBaseline([], "0.00", null).basis).toBe("sem_dados");
    expect(essentialBaseline([], "0.00", "0.00").basis).toBe("sem_dados");
  });
});

describe("situação da reserva", () => {
  it("calcula meta, falta e meses cobertos", () => {
    expect(reserveStatus("9000.00", "3000.00", 6)).toEqual({
      target: "18000.00",
      saved: "9000.00",
      missing: "9000.00",
      percent: 50,
      coveredMonths: 3,
    });
  });

  it("não passa de 100% nem falta valor negativo", () => {
    const status = reserveStatus("30000.00", "3000.00", 6);
    expect(status.percent).toBe(100);
    expect(status.missing).toBe("0.00");
    expect(status.coveredMonths).toBe(10);
  });

  it("saldo negativo conta como nada guardado", () => {
    const status = reserveStatus("-500.00", "3000.00", 6);
    expect(status.percent).toBe(0);
    expect(status.missing).toBe("18000.00");
  });

  it("sem gasto de referência não divide por zero", () => {
    expect(reserveStatus("1000.00", "0.00", 6)).toMatchObject({ percent: 0, coveredMonths: 0 });
  });

  it("falta + guardado é sempre a meta, enquanto a meta não foi atingida", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9_999_999 }),
        fc.integer({ min: 1, max: 9_999_999 }),
        fc.integer({ min: 1, max: 24 }),
        (savedCents, monthlyCents, months) => {
          const status = reserveStatus(
            (savedCents / 100).toFixed(2),
            (monthlyCents / 100).toFixed(2),
            months,
          );
          const sum = Number(status.saved) + Number(status.missing);
          if (Number(status.missing) > 0) expect(sum).toBeCloseTo(Number(status.target), 1);
          expect(status.percent).toBeGreaterThanOrEqual(0);
          expect(status.percent).toBeLessThanOrEqual(100);
        },
      ),
    );
  });
});

describe("prazo da reserva", () => {
  it("arredonda para cima", () => {
    expect(monthsToReserve("1000.00", "300.00")).toBe(4);
    expect(monthsToReserve("900.00", "300.00")).toBe(3);
  });

  it("sem aporte não há prazo", () => {
    expect(monthsToReserve("1000.00", "0")).toBeNull();
  });
});

describe("patrimônio líquido", () => {
  const empty: NetWorthInput = {
    accounts: [],
    assets: [],
    debts: [],
    cards: [],
    purchases: [],
    paidStatements: [],
  };
  const card = { id: "k", name: "Cartão", closingDay: 25, dueDay: 5 };
  const purchase = {
    id: "c",
    cardId: "k",
    categoryId: "x",
    description: "TV",
    amount: "900.00",
    installments: 3,
    purchasedOn: "2026-10-10",
  };

  it("soma contas e bens, e tira dívidas e cartões", () => {
    const result = summarizeNetWorth({
      ...empty,
      accounts: [{ id: "a", name: "Banco", balance: "1000.00", archived: false }],
      assets: [{ id: "b", value: "50000.00" }],
      debts: [{ id: "d", name: "Carro", balance: "20000.00", archived: false }],
      cards: [card],
      purchases: [purchase],
    });
    expect(result).toMatchObject({
      owned: "51000.00",
      owed: "20900.00",
      net: "30100.00",
      cards: "900.00",
    });
  });

  it("conta só as parcelas de faturas ainda não pagas", () => {
    const result = summarizeNetWorth({
      ...empty,
      cards: [card],
      purchases: [purchase],
      paidStatements: ["k:2026-11"],
    });
    expect(result.cards).toBe("600.00");
    expect(result.net).toBe("-600.00");
  });

  it("ignora contas arquivadas e dívidas encerradas", () => {
    const result = summarizeNetWorth({
      ...empty,
      accounts: [{ id: "a", name: "Velha", balance: "1000.00", archived: true }],
      debts: [{ id: "d", name: "Encerrada", balance: "500.00", archived: true }],
    });
    expect(result.net).toBe("0.00");
  });

  it("conta negativa reduz o que se tem", () => {
    const result = summarizeNetWorth({
      ...empty,
      accounts: [{ id: "a", name: "Banco", balance: "-200.00", archived: false }],
    });
    expect(result.owned).toBe("-200.00");
  });

  it("cartão sem saldo não aparece na lista", () => {
    expect(summarizeNetWorth({ ...empty, cards: [card] }).cardBalances).toEqual([]);
  });
});
