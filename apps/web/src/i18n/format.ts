// Datas e números no idioma da pessoa, sempre por aqui. Datas "AAAA-MM-DD" e meses "AAAA-MM" não têm
// fuso: formatam em UTC para o dia não mudar. Dinheiro: formatMoney, de @organizeup/domain.
import {
  formatMoney,
  money,
  type Currency,
  type MoneyInput,
  type MoneyStyle,
} from "@organizeup/domain";
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

/** Percentual com casas: "12,5%", "12.5%" e "12,5 %". */
export const formatPercentExact = (percent: number, locale: Locale, maximumFractionDigits = 3) =>
  new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits }).format(percent / 100);

/** Número comum, como quantidade de cotas: "1.234,5" em português, "1,234.5" em inglês. */
export const formatNumber = (value: number, locale: Locale) => value.toLocaleString(locale);

const decimalMark = (locale: Locale) =>
  new Intl.NumberFormat(locale).formatToParts(1.5).find((part) => part.type === "decimal")!.value;

/** Valor guardado de volta ao campo de digitação, sem milhar: "1234.5" vira "1234,5" em português. */
export const toInputValue = (value: MoneyInput, locale: Locale) =>
  money(value).toString().replace(".", decimalMark(locale));

/**
 * Valor no idioma pedido. Tela da família não usa isto: usa `useMoney` ou `getMoney`, que já sabem a
 * moeda principal. Fica para quem sabe a moeda por outro caminho: texto dos agentes e a landing.
 */
export const formatAmount = (
  value: MoneyInput,
  locale: Locale,
  style?: MoneyStyle,
  currency: Currency = "BRL",
) => formatMoney(value, currency, locale, style);

/** Formatador das telas da família. Sem `currency`, a moeda principal; a da conta entra por ele. */
export type MoneyText = (value: MoneyInput, style?: MoneyStyle, currency?: Currency) => string;

export const moneyTextFor =
  (locale: Locale, main: Currency): MoneyText =>
  (value, style, currency = main) =>
    formatMoney(value, currency, locale, style);

/** Data completa em números: "30/10/2026" em português, "10/30/2026" em inglês. */
export const formatDate = (date: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDay(date));

/** "5 de novembro". */
export const formatDayName = (date: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(
    utcDay(date),
  );

/** "quinta-feira, 5 de novembro". */
export const formatWeekdayName = (date: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(utcDay(date));

const capitalized = (text: string, locale: Locale) =>
  text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);

/** Cabeçalho do calendário, sempre de domingo a sábado: "Dom", "Seg"... */
export const weekdayNames = (locale: Locale) => {
  const format = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  // 1º de fevereiro de 2026 caiu num domingo.
  return Array.from({ length: 7 }, (_, index) =>
    capitalized(format.format(utcDay(`2026-02-0${index + 1}`)).replace(".", ""), locale),
  );
};

/** Nome do mês no meio de uma frase, de 1 a 12: "janeiro", e "January" em inglês. */
export const monthName = (month: number, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, month - 1, 15)),
  );

/** Meses para escolher numa lista, de janeiro a dezembro: "Janeiro", "Fevereiro"... */
export const monthNames = (locale: Locale) =>
  Array.from({ length: 12 }, (_, index) => capitalized(monthName(index + 1, locale), locale));

/** Valor do banco ("1234.56") para preencher um campo, como a pessoa digita: "1234,56" em português. */
export const toAmountInput = (value: string, locale: Locale) => {
  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? ".";
  return value.replace(".", decimal);
};

/** O mesmo, para campo que pode estar sem valor. */
export const toFieldValue = (value: string | null | undefined, locale: Locale) =>
  toAmountInput(value ?? "", locale);
