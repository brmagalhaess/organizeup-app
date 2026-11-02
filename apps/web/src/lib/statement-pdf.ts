// PDF do relatório, gerado no servidor com jsPDF (ADR-0021). As fontes padrão do PDF cobrem português,
// inglês e espanhol: não há arquivo de fonte para empacotar. O que não existe nelas, como emoji numa
// descrição, sai como "?" em vez de quebrar a página.
import { jsPDF } from "jspdf";
import {
  axisCeiling,
  money,
  percentOf,
  type StatementCell,
  type StatementSection,
} from "@organizeup/domain";
import type { StatementFileInfo } from "./statement-csv";
import type { StatementWriter } from "./statement-text";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = PAGE_HEIGHT - MARGIN - 14;

const INK = "#1f2933";
const MUTED = "#52606d";
const LINE = "#d9dee3";
const BRAND = "#2f7a5b";
const INCOME = "#1273a8";
const EXPENSE = "#b42318";

/** Fica só o que a codificação das fontes padrão tem. */
export const pdfText = (text: string) =>
  text
    .replace(/[    ]/g, " ")
    .replace(/−/g, "-")
    .replace(/[^\x20-\x7E¡-ÿ€–—‘’“”•…]/gu, "?");

const isNumeric = (cell: StatementCell) =>
  cell !== null && ("money" in cell || "percent" in cell || "count" in cell);

class Page {
  y = MARGIN;
  constructor(private readonly doc: jsPDF) {
    doc.setTextColor(INK);
  }

  room(height: number) {
    if (this.y + height <= BOTTOM) return false;
    this.doc.addPage();
    this.y = MARGIN;
    return true;
  }

  write(text: string, size: number, options: { bold?: boolean; color?: string; after?: number }) {
    const { doc } = this;
    doc.setFont("helvetica", options.bold ? "bold" : "normal").setFontSize(size);
    doc.setTextColor(options.color ?? INK);
    const lines = doc.splitTextToSize(pdfText(text), CONTENT) as string[];
    const height = lines.length * size * 1.3;
    this.room(height);
    doc.text(lines, MARGIN, this.y + size, { lineHeightFactor: 1.3 });
    this.y += height + (options.after ?? 6);
  }

  rule(color = LINE) {
    this.doc.setDrawColor(color).setLineWidth(0.5);
    this.doc.line(MARGIN, this.y, PAGE_WIDTH - MARGIN, this.y);
  }
}

function drawFigures(page: Page, doc: jsPDF, file: StatementFileInfo, writer: StatementWriter) {
  const columns = 3;
  const width = CONTENT / columns;
  const height = 44;
  file.data.figures.forEach((figure, index) => {
    const column = index % columns;
    if (column === 0) page.room(height);
    const x = MARGIN + column * width;
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(MUTED);
    doc.text(pdfText(writer.figure(figure.id)), x, page.y + 10, { maxWidth: width - 8 });
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(INK);
    doc.text(pdfText(writer.cell(figure.value)), x, page.y + 28, { maxWidth: width - 8 });
    if (column === columns - 1 || index === file.data.figures.length - 1) page.y += height;
  });
  page.y += 6;
}

/** Coluna de cada série, no mesmo eixo. Negativo desce da linha do zero. */
function drawColumns(
  page: Page,
  doc: jsPDF,
  section: StatementSection,
  writer: StatementWriter,
  series: number[],
) {
  const height = 90;
  const axis = 44;
  const labelRoom = 12;
  page.room(height + labelRoom + 14);
  const rows = section.rows;
  const valueOf = (row: StatementCell[], column: number) => {
    const cell = row[column] ?? null;
    return cell && "money" in cell ? cell.money : "0.00";
  };
  const values = rows.flatMap((row) => series.map((column) => valueOf(row, column)));
  const positive = values.filter((value) => money(value).gt(0));
  const negative = values.filter((value) => money(value).lt(0));
  const top = money(axisCeiling(positive.length > 0 ? positive : ["0"]));
  const bottom = money(axisCeiling(negative.length > 0 ? negative : ["0"]));
  const span = top.plus(bottom);
  if (span.isZero()) return;
  const zero = page.y + (percentOf(top.toFixed(2), span.toFixed(2)) / 100) * height;
  const step = (CONTENT - axis) / rows.length;
  const barWidth = Math.min(12, (step - 4) / series.length);

  doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(MUTED);
  doc.text(pdfText(writer.compact(top.toFixed(2))), MARGIN + axis - 4, page.y + 6, {
    align: "right",
  });
  if (!bottom.isZero()) {
    doc.text(pdfText(writer.compact(bottom.neg().toFixed(2))), MARGIN + axis - 4, page.y + height, {
      align: "right",
    });
  }
  doc.setDrawColor(LINE).setLineWidth(0.5);
  doc.line(MARGIN + axis, zero, PAGE_WIDTH - MARGIN, zero);
  rows.forEach((row, index) => {
    const start = MARGIN + axis + index * step + (step - barWidth * series.length) / 2;
    series.forEach((column, order) => {
      const value = money(valueOf(row, column));
      const size = (value.abs().dividedBy(span).toNumber() || 0) * height;
      doc.setFillColor(series.length === 1 ? BRAND : order === 0 ? INCOME : EXPENSE);
      if (size > 0) {
        doc.rect(
          start + order * barWidth,
          value.gte(0) ? zero - size : zero,
          barWidth - 1,
          size,
          "F",
        );
      }
    });
    const first = row[0] ?? null;
    const caption =
      first && "month" in first
        ? first.month.slice(5) + "/" + first.month.slice(2, 4)
        : writer.cell(first);
    doc.setFontSize(6.5).setTextColor(MUTED);
    doc.text(pdfText(caption), start + (barWidth * series.length) / 2, page.y + height + 9, {
      align: "center",
    });
  });
  page.y += height + labelRoom + 6;
  if (series.length > 1) {
    let x = MARGIN + axis;
    series.forEach((column, order) => {
      doc.setFillColor(order === 0 ? INCOME : EXPENSE);
      doc.rect(x, page.y, 7, 7, "F");
      const name = pdfText(writer.column(section.columns[column]!));
      doc.setFontSize(7.5).setTextColor(MUTED);
      doc.text(name, x + 10, page.y + 6.5);
      x += doc.getTextWidth(name) + 26;
    });
    page.y += 14;
  }
}

function drawTable(page: Page, doc: jsPDF, section: StatementSection, writer: StatementWriter) {
  const count = section.columns.length;
  const firstShare = count <= 2 ? 0.6 : Math.max(0.24, 0.42 - count * 0.03);
  const firstWidth = CONTENT * firstShare;
  const otherWidth = (CONTENT - firstWidth) / Math.max(1, count - 1);
  const xOf = (index: number) => MARGIN + (index === 0 ? 0 : firstWidth + (index - 1) * otherWidth);
  const widthOf = (index: number) => (index === 0 ? firstWidth : otherWidth);
  const size = count > 5 ? 7.5 : 8.5;
  const lineHeight = size * 1.25;

  const drawRow = (cells: string[], numeric: boolean[], bold: boolean, color: string) => {
    doc
      .setFont("helvetica", bold ? "bold" : "normal")
      .setFontSize(size)
      .setTextColor(color);
    const wrapped = cells.map(
      (text, index) => doc.splitTextToSize(pdfText(text), widthOf(index) - 6) as string[],
    );
    const lines = Math.max(...wrapped.map((item) => item.length), 1);
    wrapped.forEach((text, index) => {
      const right = numeric[index] === true;
      const x = right ? xOf(index) + widthOf(index) - 4 : xOf(index);
      doc.text(text, x, page.y + size + 2, { align: right ? "right" : "left" });
    });
    page.y += lines * lineHeight + 6;
    page.rule();
  };

  const header = () =>
    drawRow(
      section.columns.map(writer.column),
      section.columns.map((_, index) => section.rows.some((row) => isNumeric(row[index] ?? null))),
      true,
      MUTED,
    );
  header();
  for (const row of section.rows) {
    if (page.room(lineHeight * 3)) header();
    drawRow(row.map(writer.cell), row.map(isNumeric), false, INK);
  }
  page.y += 12;
}

export function statementPdf(
  file: StatementFileInfo,
  writer: StatementWriter,
  footer: (page: number, total: number) => string,
): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  doc.setProperties({ title: pdfText(file.title), creator: "OrganizeUp" });
  const page = new Page(doc);

  page.write(file.title, 18, { bold: true, after: 2 });
  page.write(file.status, 10, { color: MUTED, after: 10 });
  for (const notice of file.notices) page.write(notice, 9, { color: MUTED, after: 4 });
  if (file.whatChanged) {
    page.y += 4;
    page.write(file.whatChanged, 10, { after: 8 });
  }
  page.y += 6;
  page.rule();
  page.y += 10;
  drawFigures(page, doc, file, writer);

  for (const section of file.data.sections) {
    page.room(60);
    page.write(writer.section(section.id), 11, { bold: true, after: 6 });
    if (section.chart?.type === "columns") {
      drawColumns(page, doc, section, writer, section.chart.series);
    }
    drawTable(page, doc, section, writer);
  }

  const total = doc.getNumberOfPages();
  for (let number = 1; number <= total; number += 1) {
    doc.setPage(number);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(MUTED);
    doc.text(pdfText(footer(number, total)), MARGIN, PAGE_HEIGHT - MARGIN + 8);
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
