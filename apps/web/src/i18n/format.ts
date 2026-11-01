// Datas e números no idioma da pessoa, sempre por aqui. Datas "AAAA-MM-DD" e meses "AAAA-MM" não têm
// fuso: formatam em UTC para o dia não mudar. Dinheiro: formatMoney, de @organizeup/domain.
import { formatMoney, type Currency, type MoneyInput, type MoneyStyle } from "@organizeup/domain";
import type { Locale } from "./locales";

const utcDay = (date: string) => new Date(`${date}T12:00:00Z`);

/** "1 de novembro de 2026". */
export const formatLongDate = (date: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(utcDay(date));

/** Dia e mês para listas: "05/10" em português, "10/05" em inglês. */
export const formatDayMonth = (date: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
    utcDay(date),
  );

/** "outubro de 2026". */
export const formatMonthYear = (month: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    utcDay(`${month}-01`),
  );

/** Mês abreviado para eixos: "out". */
export const formatMonthAbbr = (month: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" })
    .format(utcDay(`${month}-01`))
    .replace(".", "");

/** Dia de um instante, como aceite ou criação: "01/11/2026". */
export const formatInstant = (instant: Date, locale: Locale) =>
  new Intl.DateTimeFormat(locale).format(instant);

/** Percentual que já vem de 0 a 100: "12%", e "12 %" em espanhol. */
export const formatPercent = (percent: number, locale: Locale) =>
  new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(
    percent / 100,
  );

/** Reais no idioma da pessoa. A moeda da conta chega na Fase 5. */
export const formatAmount = (
  value: MoneyInput,
  locale: Locale,
  style?: MoneyStyle,
  currency: Currency = "BRL",
) => formatMoney(value, currency, locale, style);
