import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CURRENCIES,
  formatBRL,
  formatBRLCompact,
  formatBRLShort,
  formatMoney,
  money,
  parseBRL,
  parseMoney,
  splitInstallments,
  toCents,
  toDbAmount,
} from "../src/money";

const LOCALES = ["pt-BR", "en", "es"];
const plain = (text: string) => text.replace(/\s/g, " ");

// Fonte dos formatos: CLDR, pelo Intl do Node 24. Em espanhol o milhar só agrupa a partir de 10 mil.
describe("formatMoney", () => {
  it.each([
    ["1234.5", "BRL", "pt-BR", "R$ 1.234,50"],
    ["1234.5", "USD", "pt-BR", "US$ 1.234,50"],
    ["1234.5", "EUR", "pt-BR", "€ 1.234,50"],
    ["1234.5", "BRL", "en", "R$1,234.50"],
    ["1234.5", "USD", "en", "$1,234.50"],
    ["1234.5", "EUR", "en", "€1,234.50"],
    ["1234.5", "BRL", "es", "1234,50 R$"],
    ["1234.5", "USD", "es", "1234,50 US$"],
    ["1234567.5", "EUR", "es", "1.234.567,50 €"],
    ["-10", "BRL", "en", "-R$10.00"],
  ] as const)("%s %s em %s", (value, currency, locale, expected) => {
    expect(plain(formatMoney(value, currency, locale))).toBe(expected);
  });

  it("tem o real em pt-BR como padrão", () => {
    expect(formatMoney("1234.5")).toBe(formatBRL("1234.5"));
  });

  it("arredonda pela regra oficial antes de formatar", () => {
    expect(plain(formatMoney("2.345", "USD", "en"))).toBe("$2.34");
  });

  it("tem os formatos curtos em qualquer moeda", () => {
    expect(plain(formatMoney("8000", "BRL", "en", "compact"))).toBe("R$8K");
    expect(plain(formatMoney("389.90", "USD", "en", "short"))).toBe("$390");
    expect(plain(formatMoney("2400", "EUR", "pt-BR", "short"))).toBe("€ 2,4 mil");
  });

  it("formatBRL e as variantes curtas seguem dando o mesmo texto de sempre", () => {
    const old = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
    const compact = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      notation: "compact",
      maximumFractionDigits: 1,
    });
    const whole = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    });
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), (cents) => {
        const amount = money(cents).dividedBy(100);
        const number = amount.toNumber();
        return (
          formatBRL(amount) === old.format(number) &&
          formatBRLCompact(amount) === compact.format(number) &&
          formatBRLShort(amount) ===
            (amount.abs().lt(1000) ? whole.format(number) : compact.format(number))
        );
      }),
    );
  });
});

describe("parseMoney", () => {
  it.each([
    ["1.234,56", "pt-BR", "1234.56"],
    ["1.234,56", "en", "1234.56"],
    ["1,234.56", "pt-BR", "1234.56"],
    ["1,234.56", "en", "1234.56"],
    ["1.234.567,89", "es", "1234567.89"],
    ["1,234,567.89", "es", "1234567.89"],
    ["R$ 10", "en", "10"],
    ["1234,50 US$", "es", "1234.5"],
    ["-€ 3,5", "pt-BR", "-3.5"],
    ["−3,50", "pt-BR", "-3.5"],
    ["0", "en", "0"],
  ])("%s em %s", (input, locale, expected) => {
    expect(parseMoney(input, locale).equals(expected)).toBe(true);
  });

  it("no que é ambíguo segue o idioma, sem adivinhar", () => {
    expect(parseMoney("1.234", "pt-BR").toString()).toBe("1234");
    expect(parseMoney("1.234", "es").toString()).toBe("1234");
    expect(parseMoney("1.234", "en").toString()).toBe("1.234");
    expect(parseMoney("1,234", "pt-BR").toString()).toBe("1.234");
    expect(parseMoney("1,234", "es").toString()).toBe("1.234");
    expect(parseMoney("1,234", "en").toString()).toBe("1234");
  });

  it("só uma leitura possível não depende do idioma", () => {
    expect(parseMoney("12,5", "en").toString()).toBe("12.5");
    expect(parseMoney("1234.56", "pt-BR").toString()).toBe("1234.56");
    expect(parseMoney("0.123", "pt-BR").toString()).toBe("0.123");
    expect(parseMoney("1.234.567", "en").toString()).toBe("1234567");
  });

  it.each([
    "",
    "abc",
    "1.23,45",
    "12,34,56",
    "1,2,3",
    "1.234.56,7",
    "1,234.56.7",
    ".50",
    "10,",
    "1.2.3",
    "--5",
    "5-",
  ])("recusa %j", (input) => {
    for (const locale of LOCALES) expect(() => parseMoney(input, locale)).toThrow(RangeError);
  });

  it("nunca repete o texto digitado na mensagem de erro", () => {
    expect(() => parseMoney("segredo")).toThrow("Valor monetário inválido.");
  });

  it("invariante: lê de volta o que formatMoney escreve, em todo idioma e moeda", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000_000_000, max: 100_000_000_000 }),
        fc.constantFrom(...LOCALES),
        fc.constantFrom(...CURRENCIES),
        (cents, locale, currency) => {
          const amount = toCents(money(cents).dividedBy(100));
          return parseMoney(formatMoney(amount, currency, locale), locale).equals(amount);
        },
      ),
    );
  });

  it("invariante: em pt-BR concorda com parseBRL no que a pessoa digita", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000_000 }), (cents) => {
        const text = formatBRL(money(cents).dividedBy(100));
        return parseMoney(text, "pt-BR").equals(parseBRL(text));
      }),
    );
  });
});

describe("formato curto", () => {
  it("arredonda abaixo de mil e abrevia acima", () => {
    expect(formatBRLShort("389.90").replace(/\s/g, " ")).toBe("R$ 390");
    expect(formatBRLShort("-389.90").replace(/\s/g, " ")).toBe("-R$ 390");
    expect(formatBRLShort("2400.00").replace(/\s/g, " ")).toBe("R$ 2,4 mil");
  });
});

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
