// Texto dos agentes no idioma de quem lê (ADR-0020, Fase 3). A linha gravada traz a chave e os valores
// crus: aqui eles viram frase. Sem chave, ou com chave que esta versão não conhece, sai o texto gravado,
// em português: linha antiga continua funcionando. Só no servidor: o catálogo tem os três idiomas.
import {
  money,
  type AccountType,
  type Message,
  type MessageParams,
  type MessageValue,
} from "@organizeup/domain";
import { createTranslator } from "next-intl";
import {
  formatAmount,
  formatDate,
  formatMonthYear,
  formatPercentExact,
  monthName,
  toInputValue,
} from "./format";
import type { Locale } from "./locales";
import { messagesFor } from "./messages";
import { systemTextOf, type SystemText } from "./system-text";

type Translate = (key: string, values?: Record<string, string | number>) => string;

interface Writer {
  locale: Locale;
  t: Translate;
  system: SystemText;
}

const writers = new Map<string, Writer>();

function writerFor(locale: Locale, accountType: AccountType = "pf"): Writer {
  const key = `${locale}|${accountType}`;
  const known = writers.get(key);
  if (known) return known;
  // Erro vira exceção: quem chama cai no texto gravado, em vez de mostrar reticências.
  const fail = (error: Error) => {
    throw error;
  };
  const messages = messagesFor(locale, "BRL", accountType);
  const writer: Writer = {
    locale,
    t: createTranslator({
      locale,
      messages,
      namespace: "agentes" as never,
      onError: fail,
    }) as unknown as Translate,
    system: systemTextOf(
      createTranslator({
        locale,
        messages,
        namespace: "sistema" as never,
        onError: fail,
      }) as never,
    ),
  };
  writers.set(key, writer);
  return writer;
}

/** Valor gravado, formatado no idioma. Formato desconhecido lança: a linha fica com o texto gravado. */
function valueText(value: MessageValue, writer: Writer): string | number {
  if (typeof value === "string" || typeof value === "number") return value;
  const { locale, system } = writer;
  if ("money" in value) return formatAmount(value.money, locale, "full", value.currency);
  if ("month" in value) return formatMonthYear(value.month, locale);
  if ("date" in value) return formatDate(value.date, locale);
  if ("percent" in value) return formatPercentExact(value.percent, locale, 2);
  if ("quantity" in value) return toInputValue(money(value.quantity).toDecimalPlaces(8), locale);
  if ("monthName" in value) return monthName(value.monthName, locale);
  if ("category" in value) return system.name(value.category);
  if ("categories" in value) return value.categories.map(system.name).join(", ");
  if ("message" in value) return sentence(value.message, writer);
  if ("messages" in value)
    return value.messages.map((item) => sentence(item, writer)).join(value.separator ?? " ");
  throw new Error("valor de mensagem desconhecido");
}

function valuesOf(params: MessageParams | undefined, writer: Writer) {
  return Object.fromEntries(
    Object.entries(params ?? {}).map(([name, value]) => [name, valueText(value, writer)]),
  );
}

function sentence({ key, params }: Message, writer: Writer): string {
  return writer.t(key, valuesOf(params, writer));
}

/** O que foi gravado. `messageParams` vem do jsonb: a forma é conferida ao formatar. */
export interface StoredText {
  title: string;
  body: string;
  messageKey?: string | null;
  messageParams?: Record<string, unknown> | null;
}

export interface ShownText {
  title: string;
  body: string;
  /** Falso: é o texto gravado, em português. A tela marca com `lang`. */
  translated: boolean;
}

/** Título e corpo de uma linha gravada por chave. */
export function agentText(
  stored: StoredText,
  locale: Locale,
  accountType?: AccountType,
): ShownText {
  const { title, body, messageKey, messageParams } = stored;
  if (!messageKey) return { title, body, translated: false };
  try {
    const writer = writerFor(locale, accountType);
    const values = valuesOf(
      (messageParams as MessageParams | null | undefined) ?? undefined,
      writer,
    );
    return {
      title: writer.t(`${messageKey}.title`, values),
      body: writer.t(`${messageKey}.body`, values),
      translated: true,
    };
  } catch {
    return { title, body, translated: false };
  }
}

/** Uma frase só, como a nota do plano da meta. */
export function agentSentence(
  stored: string,
  key: string | null | undefined,
  params: Record<string, unknown> | null | undefined,
  locale: Locale,
): string {
  if (!key) return stored;
  try {
    return sentence(
      { key: key as Message["key"], params: (params ?? {}) as MessageParams },
      writerFor(locale),
    );
  } catch {
    return stored;
  }
}
