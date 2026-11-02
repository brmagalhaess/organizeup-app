// Conta PF tem família; conta PJ tem sócios. As chaves são as mesmas, e o catálogo da empresa muda o texto.
import { createTranslator, type AbstractIntlMessages } from "next-intl";
import { describe, expect, it } from "vitest";
import { LOCALES } from "./locales";
import { companyTexts, messagesFor } from "./messages";

function leaves(tree: AbstractIntlMessages, prefix = ""): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]): Array<[string, string]> => {
    const name = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [[name, value]] : leaves(value, name);
  });
}

const variables = (text: string) =>
  [...new Set([...text.matchAll(/\{(\w+)/g)].map((match) => match[1]!))].sort();

/**
 * O que continua falando de família numa conta PJ, de propósito: telas sem conta, que não sabem o tipo, e
 * campos que a conta PJ não mostra. Item novo aqui precisa de motivo.
 */
const KEPT = [
  /^landing\./,
  /^meta\./,
  /^auth\.signIn\./,
  /^auth\.signUp\.closedText$/,
  /^pessoas\.wedding\./,
  /^familiaOnboarding\.family\.wedding/,
  /^agentes\.frases\.viagemCasamento$/,
  /^sistema\.descricoes\.casamento$/,
  /^renda\.(simulator|form|errors)\.dependents$/,
];

const FAMILY_WORDS =
  /famíl|famil|cônjuge|cónyuge|spouse|\bfilh|\bhij[oa]|\bchild|criança|niñ[oa]|dependente|dependiente|casamento|wedding|matrimonio/i;

describe.each(LOCALES)("catálogo da empresa em %s", (locale) => {
  const family = Object.fromEntries(leaves(messagesFor(locale)));
  const company = Object.fromEntries(leaves(messagesFor(locale, "BRL", "pj")));

  it("tem as mesmas chaves do catálogo de família, nada a mais nem a menos", () => {
    expect(Object.keys(company).sort()).toEqual(Object.keys(family).sort());
  });

  it("toda chave da empresa existe no catálogo e usa as variáveis de lá", () => {
    for (const [key, text] of Object.entries(companyTexts[locale])) {
      expect(family[key], key).toBeDefined();
      const allowed = variables(family[key]!);
      for (const name of variables(text)) expect(allowed, key).toContain(name);
    }
  });

  it("todo texto da empresa é ICU válido", () => {
    const t = createTranslator({
      locale,
      messages: messagesFor(locale, "BRL", "pj"),
      onError: (error) => {
        throw error;
      },
    }) as unknown as (key: string, values: Record<string, unknown>) => string;
    const values = {
      adults: 2,
      children: 1,
      rows: 2,
      memory: 1,
      words: 1,
      noClue: 0,
      count: 1,
      name: "Ana",
      family: "Exemplo",
      inviter: "Bia",
      role: "adult",
      expires: "1/1",
      date: "1/1",
    };
    for (const key of Object.keys(companyTexts[locale])) {
      if (companyTexts[locale][key]!.includes("<link>")) continue;
      expect(t(key, values).trim().length, key).toBeGreaterThan(0);
    }
  });

  it("não sobra família, parentesco nem casamento fora da lista conhecida", () => {
    const left = Object.entries(company)
      .filter(
        ([key, text]) =>
          FAMILY_WORDS.test(text.replaceAll("{family}", "")) &&
          !KEPT.some((rule) => rule.test(key)),
      )
      .map(([key]) => key);
    expect(left).toEqual([]);
  });

  it("conta PF continua igual", () => {
    expect(messagesFor(locale, "BRL", "pf")).toBe(messagesFor(locale));
  });
});

describe("tipo da conta", () => {
  it("todo idioma traduz todas as chaves da empresa, sem cair no português", () => {
    const keys = Object.keys(companyTexts["pt-BR"]).sort();
    expect(Object.keys(companyTexts.en).sort()).toEqual(keys);
    expect(Object.keys(companyTexts.es).sort()).toEqual(keys);
  });

  it("o catálogo de empresa e a moeda funcionam juntos", () => {
    const t = createTranslator({
      locale: "pt-BR",
      messages: messagesFor("pt-BR", "USD", "pj"),
    }) as unknown as (key: string) => string;
    expect(t("pessoas.metaTitle")).toBe("Sócios");
  });
});
