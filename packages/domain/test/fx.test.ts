import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  balanceInMain,
  convertMoney,
  crossQuote,
  crossQuoteOn,
  currencySymbol,
  entryFromMain,
  entryFromTyped,
  entryOrigin,
  fitsAmount,
  fromMain,
  fxNoteOf,
  fxNoteText,
  isForeign,
  quoteOn,
  suggestTransfer,
  toMain,
  transferRate,
} from "../src/fx";
import { CURRENCIES, money } from "../src/money";

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

describe("toMain e fromMain", () => {
  it.each([
    ["100.00", "5.42120000", "542.12"],
    ["1234.56", "6.05220000", "7471.80"],
    ["0.01", "5.42120000", "0.05"],
  ])("%s a %s dá R$ %s", (value, quote, reais) => {
    expect(toMain(value, quote)).toBe(reais);
  });

  it("arredonda meio centavo para o par, a regra do ADR-0004", () => {
    expect(toMain("10.00", "5.42050000")).toBe("54.20");
    expect(toMain("10.00", "5.42150000")).toBe("54.22");
  });

  it("não aceita number nem na execução", () => {
    expect(() => toMain(100 as unknown as string, "5")).toThrow(TypeError);
    expect(() => fromMain("100", 5 as unknown as string)).toThrow(TypeError);
  });

  it("devolve sempre centavos, a menos de meio centavo da conta exata", () => {
    fc.assert(
      fc.property(cents, rate, (value, quote) => {
        const result = toMain(value, quote);
        expect(result).toMatch(/^\d+\.\d{2}$/);
        expect(money(result).minus(value.times(quote)).abs().lte("0.005")).toBe(true);
      }),
    );
  });

  it("ida e volta perde no máximo um centavo por cotação", () => {
    fc.assert(
      fc.property(cents, rate, (value, quote) => {
        const back = fromMain(toMain(value, quote), quote);
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
        expect(money(toMain(low, quote)).lte(toMain(high, quote))).toBe(true);
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
      brlAmount: null,
      brlRate: null,
    });
  });

  it("em dólar, amount em reais e o digitado ao lado", () => {
    expect(entryFromTyped("100", "USD", rates.USD)).toEqual({
      amount: "542.12",
      originalAmount: "100.00",
      originalCurrency: "USD",
      fxRate: "5.42120000",
      brlAmount: null,
      brlRate: null,
    });
  });

  it("sem cotação, recusa", () => {
    expect(entryFromTyped("100", "USD", null)).toBeNull();
    expect(entryFromMain("100", "EUR", null)).toBeNull();
  });

  it("compromisso em reais fica exato em reais", () => {
    expect(entryFromMain("543.21", "USD", rates.USD)).toEqual({
      amount: "543.21",
      originalAmount: "100.20",
      originalCurrency: "USD",
      fxRate: "5.42120000",
      brlAmount: null,
      brlRate: null,
    });
  });

  it("nunca sai menos de um centavo da conta", () => {
    expect(entryFromMain("0.01", "USD", rates.USD)?.originalAmount).toBe("0.01");
  });

  it("conta se o valor convertido cabe na coluna", () => {
    expect(fitsAmount("999999999999.99")).toBe(true);
    expect(fitsAmount("1000000000000.00")).toBe(false);
  });
});

describe("saldo em reais", () => {
  it("converte pela cotação; real fica como está", () => {
    expect(balanceInMain("1000.00", "USD", rates)).toBe("5421.20");
    expect(balanceInMain("1000.00", "BRL", {})).toBe("1000.00");
    expect(balanceInMain("-10.00", "EUR", rates)).toBe("-60.52");
  });

  it("sem cotação devolve null", () => {
    expect(balanceInMain("1000.00", "USD", {})).toBeNull();
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

describe("conversão entre as três moedas, com o real como pivô", () => {
  // Conta feita com as PTAX de 30/10/2026: 6,0522 ÷ 5,4212 = 1,11640...; 1 ÷ 5,4212 = 0,18446...
  it("euro em dólar passa pelo real", () => {
    expect(crossQuote("EUR", "USD", rates)).toEqual({ rate: "1.11639489", date: "2026-10-30" });
    expect(convertMoney("100.00", "EUR", "USD", rates)).toBe("111.64");
    expect(convertMoney("100.00", "USD", "EUR", rates)).toBe("89.57");
  });

  it("real em dólar e em euro", () => {
    expect(crossQuote("BRL", "USD", rates)).toEqual({ rate: "0.18446100", date: "2026-10-30" });
    expect(convertMoney("542.12", "BRL", "USD", rates)).toBe("100.00");
    expect(convertMoney("605.22", "BRL", "EUR", rates)).toBe("100.00");
  });

  it("dólar em real é o valor vezes a PTAX", () => {
    expect(crossQuote("USD", "BRL", rates)).toEqual({ rate: "5.42120000", date: "2026-10-30" });
    expect(convertMoney("100.00", "USD", "BRL", rates)).toBe("542.12");
  });

  it("moedas iguais não convertem", () => {
    expect(crossQuote("USD", "USD", rates)).toBeNull();
    expect(convertMoney("10.005", "USD", "USD", {})).toBe("10.00");
  });

  it("sem cotação de uma das duas, null", () => {
    expect(crossQuote("EUR", "USD", { USD: rates.USD })).toBeNull();
    expect(convertMoney("10.00", "EUR", "USD", { EUR: rates.EUR })).toBeNull();
    expect(convertMoney("10.00", "BRL", "USD", {})).toBeNull();
  });

  it("o dia é o da cotação mais antiga", () => {
    const older = { USD: rates.USD, EUR: { date: "2026-10-28", rate: "5.95150000" } };
    expect(crossQuote("EUR", "USD", older)?.date).toBe("2026-10-28");
  });

  it("nas séries, vale a última cotação até a data", () => {
    const eur = [{ date: "2026-10-30", rate: "6.05220000" }];
    expect(crossQuoteOn({ USD: series, EUR: eur }, "EUR", "USD", "2026-11-01")?.rate).toBe(
      "1.11639489",
    );
    expect(crossQuoteOn({ USD: series, EUR: eur }, "EUR", "USD", "2026-10-29")).toBeNull();
    expect(crossQuoteOn({ USD: series }, "BRL", "USD", "2026-10-29")).toEqual({
      rate: "0.18606728",
      date: "2026-10-29",
    });
  });

  const anyRates = fc.record({
    USD: fc
      .integer({ min: 1, max: 2_000_000 })
      .map((n) => ({ date: "2026-10-30", rate: (n / 10000).toFixed(4) })),
    EUR: fc
      .integer({ min: 1, max: 2_000_000 })
      .map((n) => ({ date: "2026-10-30", rate: (n / 10000).toFixed(4) })),
  });
  const cents = fc.integer({ min: 1, max: 1_000_000_00 }).map((n) => (n / 100).toFixed(2));
  const currency = fc.constantFrom(...CURRENCIES);

  it("converter e voltar perde no máximo centavos de arredondamento", () => {
    fc.assert(
      fc.property(cents, currency, currency, anyRates, (value, from, to, quotes) => {
        const there = convertMoney(value, from, to, quotes)!;
        const back = convertMoney(there, to, from, quotes)!;
        const rate = money(crossQuote(to, from, quotes)?.rate ?? 1);
        expect(money(back).minus(value).abs().lte(rate.times("0.005").plus("0.01"))).toBe(true);
      }),
    );
  });

  it("passar pelo real dá o mesmo que converter direto", () => {
    fc.assert(
      fc.property(cents, anyRates, (value, quotes) => {
        const direct = money(value).times(quotes.USD.rate).dividedBy(quotes.EUR.rate);
        const pivot = convertMoney(value, "USD", "EUR", quotes)!;
        expect(money(pivot).minus(direct).abs().lte("0.005")).toBe(true);
      }),
    );
  });
});

describe("lançamento com moeda principal fora do real", () => {
  const brlInUsd = crossQuote("BRL", "USD", rates);
  const eurInUsd = crossQuote("EUR", "USD", rates);

  it("conta na moeda principal não guarda origem", () => {
    expect(entryFromTyped("100.00", "USD", null, "USD")).toEqual({
      amount: "100.00",
      originalAmount: null,
      originalCurrency: null,
      fxRate: null,
      brlAmount: null,
      brlRate: null,
    });
  });

  it("conta em real é a estrangeira, e a origem fica nas colunas próprias", () => {
    const entry = entryFromTyped("542.12", "BRL", brlInUsd, "USD")!;
    expect(entry).toMatchObject({
      amount: "100.00",
      originalAmount: null,
      originalCurrency: null,
      brlAmount: "542.12",
      brlRate: "0.18446100",
    });
    expect(entryOrigin(entry)).toEqual({ amount: "542.12", currency: "BRL", rate: "0.18446100" });
  });

  it("euro em família em dólar segue nas colunas de sempre", () => {
    const entry = entryFromTyped("100.00", "EUR", eurInUsd, "USD")!;
    expect(entry).toMatchObject({
      amount: "111.64",
      originalAmount: "100.00",
      originalCurrency: "EUR",
      fxRate: "1.11639489",
    });
    expect(entryOrigin(entry)).toEqual({ amount: "100.00", currency: "EUR", rate: "1.11639489" });
  });

  it("um centavo de real não vira zero", () => {
    expect(entryFromTyped("0.01", "BRL", brlInUsd, "USD")?.amount).toBe("0.01");
  });

  it("compromisso na moeda principal fica exato em conta em real", () => {
    const entry = entryFromMain("100.00", "BRL", brlInUsd, "USD")!;
    expect(entry).toMatchObject({ amount: "100.00", brlAmount: "542.12" });
  });

  it("conta estrangeira sem cotação não grava", () => {
    expect(entryFromTyped("1.00", "BRL", null, "USD")).toBeNull();
    expect(entryFromMain("1.00", "EUR", null, "USD")).toBeNull();
  });

  it("família em real segue exatamente igual", () => {
    expect(entryFromTyped("100.00", "USD", rates.USD)).toEqual(
      entryFromTyped("100.00", "USD", rates.USD, "BRL"),
    );
    expect(entryFromTyped("100.00", "BRL", null)?.originalAmount).toBeNull();
  });

  it("saldo e aviso seguem a moeda principal", () => {
    expect(balanceInMain("542.12", "BRL", rates, "USD")).toBe("100.00");
    expect(fxNoteOf([{ currency: "USD" }], {}, "USD")).toBeNull();
    expect(fxNoteOf([{ currency: "BRL" }], rates, "USD")).toEqual({
      date: "2026-10-30",
      missing: [],
    });
    expect(fxNoteOf([{ currency: "BRL" }], {}, "USD")).toEqual({ date: null, missing: ["USD"] });
    expect(fxNoteOf([{ currency: "EUR" }], { EUR: rates.EUR }, "USD")?.missing).toEqual(["USD"]);
  });
});

describe("moedas", () => {
  it("real não é estrangeira", () => {
    expect(isForeign("BRL")).toBe(false);
    expect(isForeign("USD")).toBe(true);
  });

  it("em família em dólar, o real é a estrangeira", () => {
    expect(isForeign("BRL", "USD")).toBe(true);
    expect(isForeign("USD", "USD")).toBe(false);
  });

  it("símbolo para o rótulo", () => {
    expect(currencySymbol("USD")).toBe("US$");
    expect(currencySymbol("EUR")).toBe("€");
  });
});
