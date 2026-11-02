// CSV do relatório. Em português e espanhol, a planilha abre com `;` e vírgula decimal; em inglês, com
// `,` e ponto. Valores saem como número, com a moeda no cabeçalho, para a pessoa poder somar.
import type { Locale } from "@/i18n/locales";
import type { StatementCell, StatementData } from "@organizeup/domain";
import type { StatementWriter } from "./statement-text";

export interface StatementFileInfo {
  data: StatementData;
  /** Título do arquivo: tipo e período. */
  title: string;
  status: string;
  /** Aviso de parcial, de "atualizado em" e notas, nesta ordem. */
  notices: string[];
  whatChanged: string | null;
  labels: { currency: string; figures: string };
}

const separatorOf = (locale: Locale) => (locale === "en" ? "," : ";");
const decimalOf = (locale: Locale) => (locale === "en" ? "." : ",");

/** Planilha trata `=`, `+`, `-` e `@` no começo como fórmula: texto digitado não pode virar uma. */
const safeText = (text: string) => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text);

function quoted(value: string, separator: string) {
  const needs = value.includes(separator) || /["\r\n]/.test(value);
  return needs ? `"${value.replaceAll('"', '""')}"` : value;
}

function cellText(cell: StatementCell, writer: StatementWriter): string {
  if (!cell) return "";
  const decimal = decimalOf(writer.locale);
  if ("money" in cell) return cell.money.replace(".", decimal);
  if ("percent" in cell) return `${String(cell.percent).replace(".", decimal)}%`;
  if ("count" in cell) return String(cell.count);
  if ("text" in cell || "category" in cell) return safeText(writer.cell(cell));
  return writer.cell(cell);
}

export function statementCsv(file: StatementFileInfo, writer: StatementWriter): string {
  const separator = separatorOf(writer.locale);
  const line = (values: string[]) => values.map((v) => quoted(v, separator)).join(separator);
  const lines: string[] = [
    line([file.title]),
    line([file.status]),
    line([file.labels.currency, writer.currency]),
  ];
  for (const notice of file.notices) lines.push(line([notice]));
  if (file.whatChanged) lines.push(line([safeText(file.whatChanged)]));
  lines.push("", line([file.labels.figures]));
  for (const figure of file.data.figures) {
    lines.push(line([writer.figure(figure.id), cellText(figure.value, writer)]));
  }
  for (const section of file.data.sections) {
    lines.push("", line([writer.section(section.id)]));
    lines.push(line(section.columns.map(writer.column)));
    for (const row of section.rows) lines.push(line(row.map((cell) => cellText(cell, writer))));
  }
  // O BOM faz a planilha ler acentos em UTF-8.
  return `﻿${lines.join("\r\n")}\r\n`;
}
