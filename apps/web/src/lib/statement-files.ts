// Leitura de Excel e PDF no navegador: o arquivo não sai da máquina (ADR-0006). As bibliotecas são
// grandes, por isso só carregam quando alguém escolhe um arquivo desses.

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const iso = value.toISOString().slice(0, 10);
    return iso.split("-").reverse().join("/");
  }
  return String(value);
}

/** Primeira aba da planilha, no mesmo formato da tabela do CSV. */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  const { readSheet } = await import("read-excel-file/web-worker");
  const rows = await readSheet(file);
  return rows
    .map((row) => row.map(cellText))
    .filter((row) => row.some((cell) => cell.trim().length > 0));
}

/** Linhas de texto do PDF, na ordem de leitura. PDF escaneado não tem texto e volta vazio. */
export async function readPdfLines(file: File): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: string[] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
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
    const ordered = [...byLine.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, cells] of ordered) {
      lines.push(
        cells
          .sort((a, b) => a.x - b.x)
          .map((cell) => cell.text)
          .join(" "),
      );
    }
  }
  return lines;
}
