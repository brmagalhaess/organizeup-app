import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { formatBRL, money, parseBRL, splitInstallments, toCents, toDbAmount } from "../src/money";

describe("money", () => {
  it("evita erro de ponto flutuante", () => {
    expect(money("0.1").plus("0.2").toString()).toBe("0.3");
  });

  it("arredonda meio para o par (bancário) só na borda", () => {
    expect(toCents("2.345").toFixed(2)).toBe("2.34");
    expect(toCents("2.355").toFixed(2)).toBe("2.36");
    expect(toDbAmount("10")).toBe("10.00");
  });

  it("formata em reais pt-BR", () => {
    // Intl usa espaço não separável entre R$ e o número.
    expect(formatBRL("1234.5").replace(/\s/g, " ")).toBe("R$ 1.234,50");
  });

  it("interpreta texto digitado pelo usuário", () => {
    expect(parseBRL("1.234,56").toFixed(2)).toBe("1234.56");
    expect(parseBRL("R$ 10").toFixed(2)).toBe("10.00");
    expect(parseBRL("-3,5").toFixed(2)).toBe("-3.50");
    expect(() => parseBRL("abc")).toThrow();
  });

  it("divide em parcelas com resíduo na última", () => {
    expect(splitInstallments("100", 3).map((p) => p.toFixed(2))).toEqual([
      "33.33",
      "33.33",
      "33.34",
    ]);
  });

  it("invariante: soma das parcelas é sempre o total em centavos", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 1, max: 480 }),
        (cents, count) => {
          const total = money(cents).dividedBy(100);
          const parts = splitInstallments(total, count);
          const sum = parts.reduce((acc, p) => acc.plus(p), money(0));
          return sum.equals(toCents(total)) && parts.every((p) => p.decimalPlaces() <= 2);
        },
      ),
    );
  });
});
