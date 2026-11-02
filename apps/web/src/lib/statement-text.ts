// Relatório da família em texto, no idioma de quem lê e na moeda da família (ADR-0021). A tela, o PDF e
// o CSV escrevem por aqui, então os três dizem a mesma coisa. Valor em formato desconhecido fica vazio:
// tela de versão antiga não quebra com worker novo.
import {
  formatMoney,
  isYearPeriod,
  money,
  type Currency,
  type ReportKind,
  type MessageParams,
  type MessageValue,
  type StatementCell,
  type StatementColumn,
  type StatementFigureId,
  type StatementLabel,
  type StatementNote,
  type StatementSectionId,
} from "@organizeup/domain";
import { formatDate, formatMonthYear, formatNumber, formatPercentExact } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import type { SystemText } from "@/i18n/system-text";

export type ReportTranslate = {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
};

export interface StatementWriter {
  locale: Locale;
  currency: Currency;
  amount: (value: string) => string;
  compact: (value: string) => string;
  cell: (cell: StatementCell) => string;
  period: (period: string) => string;
  kind: (kind: ReportKind) => string;
  figure: (id: StatementFigureId) => string;
  section: (id: StatementSectionId) => string;
  column: (id: StatementColumn) => string;
  note: (id: StatementNote) => string;
  headline: (key: string | null, params: Record<string, unknown> | null) => string | null;
}

export function statementWriter(
  t: ReportTranslate,
  system: SystemText,
  locale: Locale,
  currency: Currency,
): StatementWriter {
  const amount = (value: string) => formatMoney(value, currency, locale);
  const percent = (value: number) => formatPercentExact(value, locale, 1);
  const period = (value: string) => (isYearPeriod(value) ? value : formatMonthYear(value, locale));
  const label = (id: StatementLabel) => t(`rotulos.${id}`);

  const cell = (value: StatementCell): string => {
    if (!value) return "";
    if ("money" in value) return amount(value.money);
    if ("percent" in value) return percent(value.percent);
    if ("count" in value) return formatNumber(value.count, locale);
    if ("month" in value) return formatMonthYear(value.month, locale);
    if ("date" in value) return formatDate(value.date, locale);
    if ("year" in value) return String(value.year);
    if ("text" in value) return system.description(value.text);
    if ("category" in value)
      return value.category ? system.name(value.category) : t("rotulos.semCategoria");
    if ("label" in value) return label(value.label);
    return "";
  };

  const param = (value: MessageValue): string | number => {
    if (typeof value === "string" || typeof value === "number") return value;
    if ("money" in value) return amount(money(value.money).toFixed(2));
    if ("percent" in value) return percent(value.percent);
    if ("category" in value) return cell(value);
    if ("month" in value) return formatMonthYear(value.month, locale);
    return "";
  };

  return {
    locale,
    currency,
    amount,
    compact: (value) => formatMoney(value, currency, locale, "compact"),
    cell,
    period,
    kind: (kind) => t(`tipos.${kind}`),
    figure: (id) => t(`numeros.${id}`),
    section: (id) => t(`secoes.${id}`),
    column: (id) => t(`colunas.${id}`),
    note: (id) => t(`notas.${id}`),
    headline: (key, params) => {
      if (!key || !t.has(`mensagens.${key}`)) return null;
      const entries = Object.entries((params ?? {}) as MessageParams);
      return t(
        `mensagens.${key}`,
        Object.fromEntries(entries.map(([name, value]) => [name, param(value)])),
      );
    },
  };
}
