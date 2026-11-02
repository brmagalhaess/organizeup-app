// Catálogos de texto. Um texto que falta em inglês ou espanhol aparece em português: a tela nunca fica
// com chave crua nem em branco.
import { currencySymbol, type AccountType, type Currency } from "@organizeup/domain";
import type { AbstractIntlMessages } from "next-intl";
import enCompany from "../../messages/empresa/en.json";
import esCompany from "../../messages/empresa/es.json";
import ptCompany from "../../messages/empresa/pt-BR.json";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import ptBR from "../../messages/pt-BR.json";
import type { Locale } from "./locales";

const isGroup = (value: unknown): value is AbstractIntlMessages =>
  typeof value === "object" && value !== null;

/** Base inteira, trocada pelo que existe e não está vazio em `messages`. */
export function withFallback(
  base: AbstractIntlMessages,
  messages: AbstractIntlMessages,
): AbstractIntlMessages {
  return Object.fromEntries(
    Object.entries(base).map(([key, value]) => {
      const own = messages[key];
      if (isGroup(value)) return [key, withFallback(value, isGroup(own) ? own : {})];
      return [key, typeof own === "string" && own.trim() ? own : value];
    }),
  );
}

const catalogs: Record<Locale, AbstractIntlMessages> = {
  "pt-BR": ptBR,
  en: withFallback(ptBR, en),
  es: withFallback(ptBR, es),
};

/**
 * Marcas do catálogo para a moeda principal da família, trocadas ao montar o catálogo, sem variável nem
 * código de tela. `¤`: símbolo, "Valor (¤)" vira "Valor (R$)". `¤¤`: nome no plural, "reais". `¤¤¤`: as
 * outras duas, "dólar ou euro".
 */
export const SYMBOL_MARK = "¤";
const NAME_MARK = "¤¤";
const OTHERS_MARK = "¤¤¤";

const NAMES: Record<Locale, Record<Currency, { plural: string; others: string }>> = {
  "pt-BR": {
    BRL: { plural: "reais", others: "dólar ou euro" },
    USD: { plural: "dólares", others: "real ou euro" },
    EUR: { plural: "euros", others: "real ou dólar" },
  },
  en: {
    BRL: { plural: "reais", others: "Dollar and euro" },
    USD: { plural: "dollars", others: "Real and euro" },
    EUR: { plural: "euros", others: "Real and dollar" },
  },
  es: {
    BRL: { plural: "reales", others: "dólares o euros" },
    USD: { plural: "dólares", others: "reales o euros" },
    EUR: { plural: "euros", others: "reales o dólares" },
  },
};

const withMoneyMarks = (
  messages: AbstractIntlMessages,
  locale: Locale,
  currency: Currency,
): AbstractIntlMessages => {
  const { plural, others } = NAMES[locale][currency];
  return Object.fromEntries(
    Object.entries(messages).map(([key, value]) => [
      key,
      isGroup(value)
        ? withMoneyMarks(value, locale, currency)
        : value
            .replaceAll(OTHERS_MARK, others)
            .replaceAll(NAME_MARK, plural)
            .replaceAll(SYMBOL_MARK, currencySymbol(currency)),
    ]),
  );
};

/**
 * Textos de conta de pessoa jurídica, por caminho da chave, em `messages/empresa/`. São as mesmas chaves do
 * catálogo: conta PF tem família, conta PJ tem sócios, e nenhuma tela precisa saber. O que faltar em inglês ou
 * espanhol aparece em português, como no catálogo principal.
 */
export const companyTexts: Record<Locale, Record<string, string>> = {
  "pt-BR": ptCompany,
  en: { ...ptCompany, ...enCompany },
  es: { ...ptCompany, ...esCompany },
};

function replaceAt(
  tree: AbstractIntlMessages,
  [head, ...rest]: string[],
  text: string,
): AbstractIntlMessages {
  if (!head) return tree;
  const current = tree[head];
  if (rest.length === 0) return { ...tree, [head]: text };
  return { ...tree, [head]: replaceAt(isGroup(current) ? current : {}, rest, text) };
}

const withCompanyTexts = (messages: AbstractIntlMessages, locale: Locale) =>
  Object.entries(companyTexts[locale]).reduce(
    (tree, [path, text]) => replaceAt(tree, path.split("."), text),
    messages,
  );

const prepared = new Map<string, AbstractIntlMessages>();

/** Catálogo no idioma, já com a moeda e o tipo da conta. Montado uma vez por trio e guardado. */
export function messagesFor(
  locale: Locale,
  currency: Currency = "BRL",
  accountType: AccountType = "pf",
) {
  const key = `${locale}|${currency}|${accountType}`;
  const known = prepared.get(key);
  if (known) return known;
  const base = accountType === "pj" ? withCompanyTexts(catalogs[locale], locale) : catalogs[locale];
  const messages = withMoneyMarks(base, locale, currency);
  prepared.set(key, messages);
  return messages;
}

/**
 * Último recurso, se um texto quebrado passar pelo teste: reticências, nunca o nome da chave. O
 * catálogo fica fora de provider.tsx para o navegador não baixar os três idiomas.
 */
export const LAST_RESORT = "…";
