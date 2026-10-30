import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  linesTotal,
  purchaseLines,
  statementClosingDate,
  statementDueDate,
  statementMonthOf,
  statementStatus,
  type PurchaseInput,
} from "../src/card";
import { buildSchedule, priceInstallment, simulatePayoff, type PayoffDebt } from "../src/debt";
import { money } from "../src/money";

const nubank = { closingDay: 25, dueDay: 5 };
const sameMonth = { closingDay: 3, dueDay: 12 };

const purchase = (over: Partial<PurchaseInput> = {}): PurchaseInput => ({
  id: "c1",
  cardId: "k1",
  categoryId: "lazer",
  description: "Televisão",
  amount: "1000.00",
  installments: 3,
  purchasedOn: "2026-10-10",
  ...over,
});

describe("fatura do cartão", () => {
  it("compra até o fechamento cai na fatura que vence no mês seguinte", () => {
    expect(statementMonthOf("2026-10-10", nubank)).toBe("2026-11");
    expect(statementMonthOf("2026-10-25", nubank)).toBe("2026-11");
  });

  it("compra depois do fechamento pula uma fatura", () => {
    expect(statementMonthOf("2026-10-26", nubank)).toBe("2026-12");
  });

  it("vencimento no mesmo mês do fechamento", () => {
    expect(statementMonthOf("2026-10-02", sameMonth)).toBe("2026-10");
    expect(statementMonthOf("2026-10-04", sameMonth)).toBe("2026-11");
  });

  it("fechamento no dia 31 respeita meses curtos", () => {
    const terms = { closingDay: 31, dueDay: 10 };
    expect(statementMonthOf("2026-02-28", terms)).toBe("2026-03");
    expect(statementMonthOf("2026-03-01", terms)).toBe("2026-04");
    expect(statementClosingDate("2026-03", terms)).toBe("2026-02-28");
  });

  it("informa fechamento e vencimento da fatura", () => {
    expect(statementClosingDate("2026-11", nubank)).toBe("2026-10-25");
    expect(statementDueDate("2026-11", nubank)).toBe("2026-11-05");
  });

  it("a fatura passa de aberta a fechada, atrasada e paga", () => {
    expect(statementStatus("2026-11", nubank, "2026-10-25", false)).toBe("aberta");
    expect(statementStatus("2026-11", nubank, "2026-10-26", false)).toBe("fechada");
    expect(statementStatus("2026-11", nubank, "2026-11-05", false)).toBe("fechada");
    expect(statementStatus("2026-11", nubank, "2026-11-06", false)).toBe("atrasada");
    expect(statementStatus("2026-11", nubank, "2026-11-06", true)).toBe("paga");
  });

  it("distribui as parcelas por faturas seguidas, com o resíduo na última", () => {
    const lines = purchaseLines(purchase(), nubank);
    expect(lines.map((l) => [l.statementMonth, l.amount])).toEqual([
      ["2026-11", "333.33"],
      ["2026-12", "333.33"],
      ["2027-01", "333.34"],
    ]);
  });

  it("a soma das parcelas é sempre o valor da compra", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99_999_999 }),
        fc.integer({ min: 1, max: 72 }),
        (cents, installments) => {
          const amount = (cents / 100).toFixed(2);
          const lines = purchaseLines(purchase({ amount, installments }), nubank);
          expect(lines).toHaveLength(installments);
          expect(linesTotal(lines)).toBe(amount);
        },
      ),
    );
  });
});

describe("calendário de parcelas", () => {
  const base = { firstDueDate: "2026-11-10", monthlyRate: "2", installments: 12 };

  it("prestação fixa pela fórmula da Calculadora do Cidadão (BCB)", () => {
    // PV 10.000, 2% a.m., 12 meses: 10.000 × 0,02 / (1 − 1,02^−12) = 945,60.
    expect(priceInstallment("10000.00", "2", 12)).toBe("945.60");
  });

  it("Price: parcelas iguais, juros caindo e saldo zerado", () => {
    const rows = buildSchedule({ ...base, system: "price", balance: "10000.00" });
    expect(rows[0]).toMatchObject({ amount: "945.60", interest: "200.00", principal: "745.60" });
    expect(rows[1]!.interest).toBe("185.09");
    expect(rows.slice(0, 11).every((r) => r.amount === "945.60")).toBe(true);
    expect(money(rows[11]!.amount).minus("945.60").abs().lt(1)).toBe(true);
  });

  it("SAC: amortização constante e parcela decrescente", () => {
    const rows = buildSchedule({
      ...base,
      system: "sac",
      monthlyRate: "1",
      balance: "12000.00",
    });
    expect(rows[0]).toMatchObject({ amount: "1120.00", principal: "1000.00", interest: "120.00" });
    expect(rows[11]).toMatchObject({ amount: "1010.00", principal: "1000.00", interest: "10.00" });
  });

  it("sem juros, divide o saldo", () => {
    const rows = buildSchedule({ ...base, system: "price", monthlyRate: "0", balance: "1200.00" });
    expect(rows.every((r) => r.amount === "100.00" && r.interest === "0.00")).toBe(true);
  });

  it("parcela informada: saldo é parcela × quantidade", () => {
    const rows = buildSchedule({
      ...base,
      system: "manual",
      balance: "0",
      installments: 4,
      installmentAmount: "250.50",
    });
    expect(rows.map((r) => r.principal)).toEqual(["250.50", "250.50", "250.50", "250.50"]);
  });

  it("vencimento no dia 31 cai no último dia dos meses curtos", () => {
    const rows = buildSchedule({
      ...base,
      system: "price",
      balance: "300.00",
      installments: 3,
      firstDueDate: "2027-01-31",
    });
    expect(rows.map((r) => r.dueDate)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });

  it("a amortização soma exatamente o saldo, em qualquer sistema", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 99_999_999 }),
        fc.integer({ min: 0, max: 800 }),
        fc.integer({ min: 1, max: 120 }),
        fc.constantFrom("price" as const, "sac" as const),
        (cents, rateBasis, installments, system) => {
          const balance = (cents / 100).toFixed(2);
          const rows = buildSchedule({
            system,
            balance,
            monthlyRate: (rateBasis / 100).toFixed(2),
            installments,
            firstDueDate: "2026-11-10",
          });
          const paid = rows.reduce((acc, r) => acc.plus(r.principal), money(0));
          expect(paid.toFixed(2)).toBe(balance);
        },
      ),
    );
  });
});

describe("ordem de quitação", () => {
  const debts: PayoffDebt[] = [
    { id: "a", name: "Cheque especial", balance: "1000.00", monthlyRate: "8", minimum: "150.00" },
    { id: "b", name: "Carro", balance: "12000.00", monthlyRate: "1.5", minimum: "400.00" },
    { id: "c", name: "Loja", balance: "600.00", monthlyRate: "3", minimum: "100.00" },
  ];

  it("avalanche ataca os maiores juros; bola de neve, o menor saldo", () => {
    expect(simulatePayoff(debts, "300", "avalanche").order[0]!.id).toBe("a");
    expect(simulatePayoff(debts, "300", "snowball").order[0]!.id).toBe("c");
  });

  it("indica por onde começar, mesmo que outra dívida termine antes", () => {
    const shortDebt = {
      id: "s",
      name: "Curta",
      balance: "500.00",
      monthlyRate: "1",
      minimum: "100.00",
    };
    const costly = {
      id: "k",
      name: "Cara",
      balance: "9000.00",
      monthlyRate: "5",
      minimum: "600.00",
    };
    const result = simulatePayoff([shortDebt, costly], "100", "avalanche");
    expect(result.focus?.id).toBe("k");
    expect(result.order[0]!.id).toBe("s");
  });

  it("pagar a mais encurta o prazo e reduz os juros", () => {
    const minimum = simulatePayoff(debts, "0", "minimum");
    const avalanche = simulatePayoff(debts, "300", "avalanche");
    expect(avalanche.months).toBeLessThan(minimum.months);
    expect(money(avalanche.totalInterest).lt(minimum.totalInterest)).toBe(true);
  });

  it("avalanche não paga mais juros que a bola de neve neste caso", () => {
    const avalanche = simulatePayoff(debts, "300", "avalanche");
    const snowball = simulatePayoff(debts, "300", "snowball");
    expect(money(avalanche.totalInterest).lte(snowball.totalInterest)).toBe(true);
  });

  it("avisa quando a parcela não cobre os juros", () => {
    const result = simulatePayoff(
      [{ id: "x", name: "Rotativo", balance: "5000.00", monthlyRate: "10", minimum: "100.00" }],
      "0",
      "minimum",
    );
    expect(result.stalled).toBe(true);
  });

  it("toda dívida termina uma única vez", () => {
    const { order, stalled } = simulatePayoff(debts, "100", "snowball");
    expect(stalled).toBe(false);
    expect(order.map((o) => o.id).sort()).toEqual(["a", "b", "c"]);
  });
});
