import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createTranslator, type AbstractIntlMessages } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import ptBR from "../../messages/pt-BR.json";
import { agentText } from "./agent-text";
import { moneyTextFor } from "./format";
import { LOCALES } from "./locales";
import { messagesFor, SYMBOL_MARK } from "./messages";

const src = path.resolve(import.meta.dirname, "..");

/** Todas as folhas, como "contas.form.amount". */
function leaves(tree: AbstractIntlMessages, prefix = ""): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]): Array<[string, string]> => {
    const name = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [[name, value]] : leaves(value, name);
  });
}

function sourceFiles(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const file = path.join(folder, name);
    if (statSync(file).isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(name) && !name.includes(".test.") ? [file] : [];
  });
}

/** Telas da família. A landing e o painel do serviço ficam de fora: lá é sempre real. */
const familyScreens = [
  ...sourceFiles(path.join(src, "app/app")),
  ...sourceFiles(path.join(src, "components")).filter((file) => !file.includes("landing")),
];

const textOf = (locale: (typeof LOCALES)[number], currency: "BRL" | "USD" | "EUR", key: string) =>
  createTranslator({ locale, messages: messagesFor(locale, currency) })(key as never);

describe("catálogo na moeda da família", () => {
  it("em real, sai o texto de sempre", () => {
    expect(textOf("pt-BR", "BRL", "investimentos.form.fees")).toBe("Taxas (R$)");
    expect(textOf("en", "BRL", "investimentos.form.fees")).toBe("Fees (R$)");
    expect(textOf("es", "BRL", "investimentos.form.fees")).toBe("Comisiones (R$)");
    expect(textOf("pt-BR", "BRL", "contas.form.currencyHint")).toContain("seguem em reais");
    expect(textOf("es", "BRL", "contas.form.currencyHint")).toContain("siguen en reales");
    expect(textOf("pt-BR", "BRL", "lancamentos.errors.noRepeat")).toBe(
      "Conta em dólar ou euro ainda não aceita conta que se repete. Lance mês a mês ou use uma conta em reais.",
    );
  });

  it("em dólar e euro, símbolo e nome acompanham", () => {
    expect(textOf("pt-BR", "USD", "investimentos.form.fees")).toBe("Taxas (US$)");
    expect(textOf("en", "EUR", "investimentos.form.fees")).toBe("Fees (€)");
    expect(textOf("pt-BR", "USD", "contas.form.currencyHint")).toContain("seguem em dólares");
    expect(textOf("es", "EUR", "contas.form.currencyHint")).toContain("siguen en euros");
    expect(textOf("pt-BR", "USD", "lancamentos.errors.noRepeat")).toBe(
      "Conta em real ou euro ainda não aceita conta que se repete. Lance mês a mês ou use uma conta em dólares.",
    );
    expect(textOf("en", "EUR", "lancamentos.errors.noRepeat")).toContain(
      "Real and dollar accounts",
    );
  });

  it("nenhuma marca chega à tela", () => {
    for (const locale of LOCALES) {
      for (const currency of ["BRL", "USD", "EUR"] as const) {
        const left = leaves(messagesFor(locale, currency)).filter(([, text]) =>
          text.includes(SYMBOL_MARK),
        );
        expect(left).toEqual([]);
      }
    }
  });

  it("guarda o catálogo montado", () => {
    expect(messagesFor("en", "USD")).toBe(messagesFor("en", "USD"));
  });
});

describe("sem R$ escrito à mão", () => {
  it("nos arquivos de tela da família", () => {
    expect(familyScreens.length).toBeGreaterThan(50);
    const found = familyScreens.filter((file) => readFileSync(file, "utf8").includes("R$"));
    expect(found.map((file) => path.relative(src, file))).toEqual([]);
  });

  it("no catálogo, fora do nome da moeda", () => {
    for (const catalog of [ptBR, en, es]) {
      const found = leaves(catalog)
        .filter(([, text]) => text.includes("R$"))
        .map(([key]) => key);
      expect(found).toEqual(["contas.currencies.BRL"]);
    }
  });

  it("toda tela da família formata por useMoney ou getMoney", () => {
    const found = familyScreens.filter((file) =>
      /\b(formatAmount|formatBRL|formatBRLCompact|formatBRLShort|formatMoney)\(/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(found.map((file) => path.relative(src, file))).toEqual([]);
  });
});

describe("formatador da família", () => {
  it("em real, o mesmo de sempre", () => {
    const money = moneyTextFor("pt-BR", "BRL");
    expect(money("1234.56")).toBe("R$\u00a01.234,56");
    expect(money("8000", "compact")).toBe("R$\u00a08\u00a0mil");
  });

  it("usa a moeda principal, e a da conta quando pedida", () => {
    expect(moneyTextFor("pt-BR", "USD")("1234.56")).toBe("US$\u00a01.234,56");
    expect(moneyTextFor("en", "USD")("1234.56")).toBe("$1,234.56");
    expect(moneyTextFor("es", "EUR")("1234.56")).toBe("1234,56\u00a0€");
    expect(moneyTextFor("pt-BR", "USD")("100", "full", "BRL")).toBe("R$\u00a0100,00");
  });
});

describe("texto dos agentes", () => {
  const row = (params: Record<string, unknown>) => ({
    title: "reserva",
    body: "reserva",
    messageKey: "aporteReserva",
    messageParams: {
      missing: { money: "10.00" },
      parts: { messages: [] },
      ...params,
    } as never,
  });

  it("sem moeda na linha, real", () => {
    const text = agentText(row({ amount: { money: "300.00" } }), "pt-BR");
    expect(text.title).toContain("R$");
  });

  it("com a moeda gravada, ela vale em qualquer idioma", () => {
    const usd = { money: "300.00", currency: "USD" };
    expect(agentText(row({ amount: usd }), "pt-BR").title).toContain("US$");
    expect(agentText(row({ amount: usd }), "en").title).toContain("$300.00");
    expect(agentText(row({ amount: { money: "300.00", currency: "EUR" } }), "es").title).toContain(
      "€",
    );
  });
});
