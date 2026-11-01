// Catálogos de texto. Um texto que falta em inglês ou espanhol aparece em português: a tela nunca fica
// com chave crua nem em branco.
import type { AbstractIntlMessages } from "next-intl";
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

export const messagesFor = (locale: Locale) => catalogs[locale];

/**
 * Último recurso, se um texto quebrado passar pelo teste: reticências, nunca o nome da chave. O
 * catálogo fica fora de provider.tsx para o navegador não baixar os três idiomas.
 */
export const LAST_RESORT = "…";
