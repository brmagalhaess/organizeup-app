import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import ptBR from "../../messages/pt-BR.json";
import { SYSTEM_NAMES, systemTextOf } from "./system-text";

const systemIn = (locale: "pt-BR" | "en" | "es") =>
  systemTextOf(
    createTranslator({
      locale,
      messages: { "pt-BR": ptBR, en, es }[locale],
      namespace: "sistema",
    }) as never,
  );

const pt = systemIn("pt-BR");
const inEnglish = systemIn("en");
const inSpanish = systemIn("es");

describe("nomes padrão", () => {
  it.each(Object.entries(SYSTEM_NAMES))("%s tem texto no catálogo", (name, key) => {
    expect(ptBR.sistema.nomes).toHaveProperty(key, name);
    expect(en.sistema.nomes).toHaveProperty(key);
    expect(es.sistema.nomes).toHaveProperty(key);
    expect(pt.name(name)).toBe(name);
  });

  it("traduz só enquanto o nome for exatamente o padrão", () => {
    expect(inEnglish.name("Mercado")).toBe("Groceries");
    expect(inSpanish.name("Mercado")).toBe("Supermercado");
    expect(inEnglish.name("Conta principal")).toBe("Main account");
    expect(inSpanish.name("Conta principal")).toBe("Cuenta principal");
    expect(inEnglish.name("Mercado do bairro")).toBe("Mercado do bairro");
    expect(inEnglish.name("mercado")).toBe("mercado");
    expect(inEnglish.name("Conta do João")).toBe("Conta do João");
  });
});

describe("descrições geradas pelo sistema", () => {
  const card = { category: "Cartão de crédito" };
  const contribution = { category: "Aportes e investimentos" };

  it("fatura", () => {
    expect(inEnglish.description("Fatura Nubank", card)).toBe("Nubank bill");
    expect(inSpanish.description("Fatura Nubank", card)).toBe("Factura Nubank");
    expect(inEnglish.description("Fatura Nubank", { bill: true })).toBe("Nubank bill");
  });

  it("aporte e resgate", () => {
    expect(inEnglish.description("Aporte em PETR4", contribution)).toBe("Contribution to PETR4");
    expect(inSpanish.description("Resgate de PETR4", contribution)).toBe("Retiro de PETR4");
  });

  it("parcela de meta", () => {
    expect(inEnglish.description("Meta: Carro (1/10)")).toBe("Goal: Carro (1/10)");
    expect(inSpanish.description("Meta: Carro (1/10)")).toBe("Meta: Carro (1/10)");
  });

  it("viagem e aniversário de casamento", () => {
    expect(inEnglish.description("Viagem: Lisboa", { trip: true })).toBe("Trip: Lisboa");
    expect(inSpanish.description("Viagem: Lisboa", { trip: true })).toBe("Viaje: Lisboa");
    expect(inEnglish.description("Aniversário de casamento")).toBe("Wedding anniversary");
  });

  it("renda", () => {
    expect(inEnglish.description("Férias · Empresa X")).toBe("Vacation · Empresa X");
    expect(inEnglish.description("13º salário · Empresa X")).toBe("13th salary · Empresa X");
    expect(inEnglish.description("13º, 1ª parcela · Empresa X")).toBe(
      "13th salary, 1st installment · Empresa X",
    );
    expect(inSpanish.description("13º, 2ª parcela · Empresa X")).toBe(
      "Aguinaldo, 2.ª cuota · Empresa X",
    );
  });

  it("em português, nada muda", () => {
    const examples: Array<[string, Parameters<typeof pt.description>[1]]> = [
      ["Fatura Nubank", card],
      ["Aporte em PETR4", contribution],
      ["Resgate de PETR4", contribution],
      ["Meta: Carro (1/10)", {}],
      ["Viagem: Lisboa", { trip: true }],
      ["Aniversário de casamento", {}],
      ["Férias · Empresa X", {}],
      ["13º, 1ª parcela · Empresa X", {}],
    ];
    for (const [text, origin] of examples) expect(pt.description(text, origin)).toBe(text);
  });

  it("o que a família digitou fica como está", () => {
    expect(inEnglish.description("Mercado da esquina")).toBe("Mercado da esquina");
    expect(inEnglish.description("Fatura da luz", { category: "Luz, água e internet" })).toBe(
      "Fatura da luz",
    );
    expect(inEnglish.description("Aporte em dinheiro", { category: "Outras receitas" })).toBe(
      "Aporte em dinheiro",
    );
    expect(inEnglish.description("Viagem: Paris")).toBe("Viagem: Paris");
    expect(inEnglish.description("Meta: juntar 10 mil")).toBe("Meta: juntar 10 mil");
  });
});
