import { describe, expect, it } from "vitest";
import {
  joinReplaces,
  looksLikeCardBill,
  statementCarry,
  statementPaidOn,
  type JoinInput,
} from "../src/card";

describe("a linha do extrato parece pagamento de fatura", () => {
  it("fatura, ou pagamento e cartão, nas variações dos bancos", () => {
    for (const text of [
      "Pagamento de fatura",
      "PGTO FAT CARTAO C6",
      "DEB AUTOMATICO FATURA CARTAO",
      "Pagto cartão de crédito",
      "GASTOS CARTAO DE CREDITO",
      "DEB AUT CARTAO CREDITO",
      // Sugestão larga de propósito: a família decide se junta.
      "FATURA ENEL",
    ]) {
      expect(looksLikeCardBill(text), text).toBe(true);
    }
  });

  it("compra, débito e boleto não são sugeridos", () => {
    for (const text of [
      "Compra cartão débito MERCADO",
      "CARTAO VISA ELECTRON PAG*MERCADINHO",
      "Pagamento de boleto - CARTAO DE TODOS",
      "Pagamento cartao de debito loja",
      "Pix enviado para Loja de Cartões",
      "Faturamento mensal",
      "SUPERMERCADO",
    ]) {
      expect(looksLikeCardBill(text), text).toBe(false);
    }
  });
});

describe("a fatura que um pagamento quita", () => {
  // Fecha dia 4, vence dia 11.
  const card = { closingDay: 4, dueDay: 11 };

  it("é a primeira que vence a partir de alguns dias antes do pagamento", () => {
    expect(statementPaidOn("2026-11-01", card, 10)).toBe("2026-11");
    expect(statementPaidOn("2026-11-09", card, 10)).toBe("2026-11");
    expect(statementPaidOn("2026-11-21", card, 10)).toBe("2026-11");
    expect(statementPaidOn("2026-11-22", card, 10)).toBe("2026-12");
    expect(statementPaidOn("2026-10-25", card, 10)).toBe("2026-11");
  });

  it("vira o ano e respeita o mês curto", () => {
    expect(statementPaidOn("2026-12-28", card, 10)).toBe("2027-01");
    expect(statementPaidOn("2027-02-28", { closingDay: 20, dueDay: 31 }, 10)).toBe("2027-02");
  });
});

describe("quanto do débito toma o lugar do pagamento marcado à mão", () => {
  const base: JoinInput = {
    amount: "230.00",
    mainAmount: "1000.00",
    mainByHand: true,
    carry: "0.00",
    mode: "auto",
  };

  it("fatura marcada como paga inteira: o débito do banco é parte do que foi marcado", () => {
    expect(joinReplaces(base)).toBe("230.00");
    // Nunca troca mais do que estava marcado.
    expect(joinReplaces({ ...base, amount: "1500.00" })).toBe("1000.00");
  });

  it("débito igual ao saldo levado é o complemento que faltava, e não troca nada", () => {
    const partial = { ...base, mainAmount: "600.00", carry: "400.00" };
    expect(joinReplaces({ ...partial, amount: "400.00" })).toBe("0.00");
    // Outro valor, com saldo levado: é o marcado aparecendo no banco.
    expect(joinReplaces({ ...partial, amount: "350.00" })).toBe("350.00");
  });

  it("a família pode dizer o que é, e pagamento principal do banco nunca é trocado", () => {
    expect(joinReplaces({ ...base, mode: "extra" })).toBe("0.00");
    const partial = { ...base, mainAmount: "600.00", carry: "400.00", amount: "400.00" };
    expect(joinReplaces({ ...partial, mode: "marcado" })).toBe("400.00");
    expect(joinReplaces({ ...base, mainByHand: false })).toBe("0.00");
    expect(joinReplaces({ ...base, mainByHand: false, mode: "marcado" })).toBe("0.00");
  });
});

describe("o que a fatura leva para a seguinte", () => {
  it("é o total menos tudo o que foi pago por ela, nunca negativo", () => {
    expect(statementCarry("1000.00", ["600.00"])).toBe("400.00");
    expect(statementCarry("1000.00", ["600.00", "230.00", "170.00"])).toBe("0.00");
    expect(statementCarry("1000.00", ["600.00", "500.00"])).toBe("0.00");
    expect(statementCarry("1000.00", [])).toBe("1000.00");
    expect(statementCarry("0.10", ["0.03", "0.03", "0.03"])).toBe("0.01");
  });
});
