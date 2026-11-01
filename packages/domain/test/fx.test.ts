import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  balanceInReais,
  currencySymbol,
  entryFromReais,
  entryFromTyped,
  fitsAmount,
  fromReais,
  fxNoteOf,
  fxNoteText,
  isForeign,
  quoteOn,
  suggestTransfer,
  toReais,
  transferRate,
} from "../src/fx";
import { money } from "../src/money";

// Fonte: PTAX de venda do fechamento, SGS do Banco Central, séries 1 e 21619, consultadas em 2026-11-01.
// 30/10/2026 foi uma sexta; 31/10 e 01/11, sábado e domingo.
const series = [
  { date: "2026-10-28", rate: "5.34200000" },
  { date: "2026-10-29", rate: "5.37440000" },
  { date: "2026-10-30", rate: "5.42120000" },
];
const rates = {
  USD: { date: "2026-10-30", rate: "5.42120000" },
  EUR: { date: "2026-10-30", rate: "6.05220000" },
};

const cents = fc.bigInt({ min: 1n, max: 99_999_999_999n }).map((n) => money(n.toString()).div(100));
const rate = fc.bigInt({ min: 10_000_000n, max: 2_000_000_000n }).map((n) => {
  return money(n.toString()).div(100_000_000);
});

describe("toReais e fromReais", () => {
  it.each([
    ["100.00", "5.42120000", "542.12"],
    ["1234.56", "6.05220000", "7471.80"],
    ["0.01", "5.42120000", "0.05"],
  ])("%s a %s dá R$ %s", (value, quote, reais) => {
    expect(toReais(value, quote)).toBe(reais);
  });

  it("arredonda meio centavo para o par, a regra do ADR-0004", () => {
    expect(toReais("10.00", "5.42050000")).toBe("54.20");
    expect(toReais("10.00", "5.42150000")).toBe("54.22");
  });

  it("não aceita number nem na execução", () => {
    expect(() => toReais(100 as unknown as string, "5")).toThrow(TypeError);
    expect(() => fromReais("100", 5 as unknown as string)).toThrow(TypeError);
  });

  it("devolve sempre centavos, a menos de meio centavo da conta exata", () => {
    fc.assert(
      fc.property(cents, rate, (value, quote) => {
        const result = toReais(value, quote);
        expect(result).toMatch(/^\d+\.\d{2}$/);
        expect(money(result).minus(value.times(quote)).abs().lte("0.005")).toBe(true);
      }),
    );
  });

  it("ida e volta perde no máximo um centavo por cotação", () => {
    fc.assert(
      fc.property(cents, rate, (value, quote) => {
        const back = fromReais(toReais(value, quote), quote);
        expect(money(back).minus(value).abs().lte(money("0.005").div(quote).plus("0.005"))).toBe(
          true,
        );
      }),
    );
  });

  it("valor maior nunca converte para menos", () => {
    fc.assert(
      fc.property(cents, cents, rate, (a, b, quote) => {
        const [low, high] = a.lte(b) ? [a, b] : [b, a];
        expect(money(toReais(low, quote)).lte(toReais(high, quote))).toBe(true);
      }),
    );
  });
});

describe("quoteOn", () => {
  it("usa a cotação do próprio dia", () => {
    expect(quoteOn(series, "2026-10-29")?.rate).toBe("5.37440000");
  });

  it("no fim de semana usa a de sexta", () => {
    expect(quoteOn(series, "2026-10-31")).toEqual(series[2]);
    expect(quoteOn(series, "2026-11-01")).toEqual(series[2]);
  });

  it("data futura usa a última", () => {
    expect(quoteOn(series, "2030-01-01")).toEqual(series[2]);
  });

  it("sem cotação até a data devolve null", () => {
    expect(quoteOn(series, "2016-01-01")).toBeNull();
    expect(quoteOn([], "2026-10-30")).toBeNull();
  });

  it("não depende da ordem da série", () => {
    expect(quoteOn([...series].reverse(), "2026-10-31")).toEqual(series[2]);
  });
});

describe("colunas do lançamento", () => {
  it("em real, só o valor", () => {
    expect(entryFromTyped("150.90", "BRL", null)).toEqual({
      amount: "150.90",
      originalAmount: null,
      originalCurrency: null,
      fxRate: null,
    });
  });

  it("em dólar, amount em reais e o digitado ao lado", () => {
    expect(entryFromTyped("100", "USD", rates.USD)).toEqual({
      amount: "542.12",
      originalAmount: "100.00",
      originalCurrency: "USD",
      fxRate: "5.42120000",
    });
  });

  it("sem cotação, recusa", () => {
    expect(entryFromTyped("100", "USD", null)).toBeNull();
    expect(entryFromReais("100", "EUR", null)).toBeNull();
  });

  it("compromisso em reais fica exato em reais", () => {
    expect(entryFromReais("543.21", "USD", rates.USD)).toEqual({
      amount: "543.21",
      originalAmount: "100.20",
      originalCurrency: "USD",
      fxRate: "5.42120000",
    });
  });

  it("nunca sai menos de um centavo da conta", () => {
    expect(entryFromReais("0.01", "USD", rates.USD)?.originalAmount).toBe("0.01");
  });

  it("conta se o valor convertido cabe na coluna", () => {
    expect(fitsAmount("999999999999.99")).toBe(true);
    expect(fitsAmount("1000000000000.00")).toBe(false);
  });
});

describe("saldo em reais", () => {
  it("converte pela cotação; real fica como está", () => {
    expect(balanceInReais("1000.00", "USD", rates)).toBe("5421.20");
    expect(balanceInReais("1000.00", "BRL", {})).toBe("1000.00");
    expect(balanceInReais("-10.00", "EUR", rates)).toBe("-60.52");
  });

  it("sem cotação devolve null", () => {
    expect(balanceInReais("1000.00", "USD", {})).toBeNull();
  });
});

describe("nota de conversão", () => {
  it("só real não diz nada", () => {
    expect(fxNoteOf([{ currency: "BRL" }], rates)).toBeNull();
    expect(fxNoteText(null)).toBeNull();
  });

  it("conta arquivada não pede nota", () => {
    expect(fxNoteOf([{ currency: "USD", archived: true }], rates)).toBeNull();
  });

  it("diz a data da cotação", () => {
    const note = fxNoteOf([{ currency: "USD" }, { currency: "BRL" }], rates);
    expect(note).toEqual({ date: "2026-10-30", missing: [] });
    expect(fxNoteText(note)).toBe("Convertido pela cotação de 30/10/2026.");
  });

  it("avisa o que ficou de fora", () => {
    const note = fxNoteOf([{ currency: "USD" }, { currency: "EUR" }], { USD: rates.USD });
    expect(note?.missing).toEqual(["EUR"]);
    expect(fxNoteText(note)).toContain("Ainda sem cotação de euro");
  });
});

describe("transferência entre moedas", () => {
  it("sugere pela cotação, nos dois sentidos", () => {
    expect(suggestTransfer("100", "USD", "BRL", rates)).toBe("542.12");
    expect(suggestTransfer("542.12", "BRL", "USD", rates)).toBe("100.00");
  });

  it("entre duas moedas estrangeiras passa pelo real", () => {
    expect(suggestTransfer("100", "USD", "EUR", rates)).toBe("89.57");
  });

  it("sem cotação não sugere", () => {
    expect(suggestTransfer("100", "USD", "BRL", {})).toBeNull();
    expect(suggestTransfer("100", "BRL", "USD", {})).toBeNull();
  });

  it("guarda reais por unidade estrangeira", () => {
    expect(transferRate("550.00", "BRL", "100.00")).toBe("5.50000000");
    expect(transferRate("100.00", "USD", "550.00")).toBe("5.50000000");
  });

  it("entre estrangeiras, destino por unidade de origem", () => {
    expect(transferRate("100.00", "USD", "90.00")).toBe("0.90000000");
  });

  it("valor zerado pelo arredondamento é recusado", () => {
    expect(transferRate("100.00", "USD", "0.00")).toBeNull();
    expect(transferRate("0.00", "BRL", "100.00")).toBeNull();
  });

  it("taxa que não cabe na coluna é recusada", () => {
    expect(transferRate("0.01", "USD", "999999999999.99")).toBeNull();
    expect(transferRate("0.01", "BRL", "999999999999.99")).toBeNull();
  });
});

describe("moedas", () => {
  it("real não é estrangeira", () => {
    expect(isForeign("BRL")).toBe(false);
    expect(isForeign("USD")).toBe(true);
  });

  it("símbolo para o rótulo", () => {
    expect(currencySymbol("USD")).toBe("US$");
    expect(currencySymbol("EUR")).toBe("€");
  });
});
