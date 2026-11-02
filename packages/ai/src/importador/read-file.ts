// Abre o arquivo no servidor, sem interpretar nada (ADR-0030). Fórmula de planilha nunca é avaliada: a
// biblioteca devolve o valor guardado na célula. `checkSmartFile` já barrou zip bomb e XML com DOCTYPE.
import {
  decodeStatement,
  type SmartContents,
  type SmartFileKind,
  type WorkbookSheet,
} from "@organizeup/domain";
import readXlsxFile from "read-excel-file/node";

export type SmartOpenFailure = "senha" | "ilegivel";

export interface OpenedFile {
  contents: SmartContents;
  /** Páginas do PDF. Null nos outros. */
  pages: number | null;
}

/** O worker vira um arquivo só, e o pdf.js acharia o próprio worker por caminho relativo. */
async function loadPdfJs() {
  const holder = globalThis as { pdfjsWorker?: unknown };
  // @ts-expect-error o pacote não traz tipos deste arquivo
  holder.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

/** Ninguém manda extrato ou contrato maior que isto, e um PDF de milhares de páginas não pode segurar o worker. */
const MAX_PDF_PAGES = 300;

async function pdfLines(bytes: Uint8Array): Promise<{ lines: string[]; pages: number }> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const pdf = await task.promise;
  try {
    const lines: string[] = [];
    for (let number = 1; number <= Math.min(pdf.numPages, MAX_PDF_PAGES); number += 1) {
      const page = await pdf.getPage(number);
      const { items } = await page.getTextContent();
      const byLine = new Map<number, Array<{ x: number; text: string }>>();
      for (const item of items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const y = Math.round(item.transform[5] / 3) * 3;
        const line = byLine.get(y) ?? [];
        line.push({ x: item.transform[4], text: item.str });
        byLine.set(y, line);
      }
      for (const [, cells] of [...byLine.entries()].sort((a, b) => b[0] - a[0])) {
        lines.push(
          cells
            .sort((a, b) => a.x - b.x)
            .map((cell) => cell.text)
            .join(" "),
        );
      }
      page.cleanup();
    }
    return { lines, pages: pdf.numPages };
  } finally {
    await task.destroy();
  }
}

async function sheetsOf(bytes: Uint8Array): Promise<WorkbookSheet[]> {
  const sheets = await readXlsxFile(Buffer.from(bytes));
  return sheets.map(({ sheet, data }) => ({ name: sheet, rows: data as WorkbookSheet["rows"] }));
}

const sheetCell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/[\t\r\n]+/g, " ");
};

/** Todas as abas, como texto: a API não recebe .xlsx. */
export const sheetsText = (sheets: WorkbookSheet[]) =>
  sheets
    .map((sheet) =>
      sheet.rows
        .map((row) => row.map(sheetCell).join("\t"))
        .filter((line) => line.trim().length > 0)
        .join("\n"),
    )
    .join("\n\n");

export async function openSmartFile(
  kind: SmartFileKind,
  bytes: Uint8Array,
  year: number,
): Promise<OpenedFile | SmartOpenFailure> {
  const blank = { kind, text: null, lines: null, sheets: null, year };
  try {
    if (kind === "pdf") {
      const { lines, pages } = await pdfLines(bytes);
      return { contents: { ...blank, lines, text: lines.join("\n") }, pages };
    }
    if (kind === "xlsx") {
      const sheets = await sheetsOf(bytes);
      return { contents: { ...blank, sheets, text: sheetsText(sheets) }, pages: null };
    }
    if (kind === "png" || kind === "jpg") return { contents: blank, pages: null };
    const text = decodeStatement(bytes);
    return { contents: { ...blank, text, lines: text.split(/\r\n|\r|\n/) }, pages: null };
  } catch (error) {
    return (error as { name?: string }).name === "PasswordException" ? "senha" : "ilegivel";
  }
}
