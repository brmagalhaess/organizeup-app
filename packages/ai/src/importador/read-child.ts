// Processo isolado que abre o arquivo e roda o reconhecimento (ADR-0030). Arquivo é dado hostil: PDF e XLSX
// podem inflar, e expressão regular pode travar. Aqui nada disso alcança o worker: sem segredos no ambiente,
// com teto de heap e de memória total, e quem manda parar é o pai, pelo relógio. Duas linhas de defesa aqui
// dentro: a thread de trabalho faz a leitura, e a principal só vigia a memória, porque continua livre mesmo com
// a outra num laço. Entrada pela stdin; saída, um JSON na stdout. Nada do arquivo vai para log.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import {
  decodeStatement,
  planSmartDuplicates,
  recognizeSmartFile,
  type SmartContents,
  type SmartFileKind,
  type SmartItemRef,
  type SmartKnown,
  type SmartReading,
  type SmartVerdict,
  type WorkbookSheet,
} from "@organizeup/domain";
import { assertPdfSize, assertZipSize, BombError, sheetsText } from "./read-limits";

export type SmartReadFailure = "senha" | "ilegivel" | "bomba" | "demorado" | "isolamento";

interface ChildJob {
  read?: SmartReadRequest;
  plan?: SmartPlanRequest;
}

export interface SmartReadRequest {
  kind: SmartFileKind;
  year: number;
  bytes: Uint8Array;
}

/** Comparação do lote: pura, mas pesada, e não pode segurar o worker. */
export interface SmartPlanRequest {
  items: SmartItemRef[];
  known: SmartKnown;
  sha: Record<string, string>;
  scope: Record<string, { accountId: string | null; cardId: string | null }>;
}

export type SmartPlanResult = { ok: true; verdicts: Array<[string, SmartVerdict]> } | { ok: false };

export type SmartReadResult =
  | {
      ok: true;
      /** Texto para o modelo, quando as regras não entenderem. Nulo em imagem. */
      text: string | null;
      pages: number | null;
      reading: SmartReading | null;
      peakRssMb: number;
    }
  | { ok: false; failure: SmartReadFailure };

/** Bastante para o modelo, com folga para a limpeza. Texto maior que isto não sai daqui. */
const MAX_TEXT_CHARS = 400_000;
const MAX_PDF_PAGES = 300;
const WATCH_MS = 25;
const MEMORY_EXIT = 42;
async function loadPdfJs() {
  const holder = globalThis as { pdfjsWorker?: unknown };
  // @ts-expect-error o pacote não traz tipos deste arquivo
  holder.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

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
        const line = byLine.get(y);
        if (line) line.push({ x: item.transform[4], text: item.str });
        else byLine.set(y, [{ x: item.transform[4], text: item.str }]);
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
  const { default: readXlsxFile } = await import("read-excel-file/node");
  const sheets = await readXlsxFile(Buffer.from(bytes));
  return sheets.map(({ sheet, data }) => ({ name: sheet, rows: data as WorkbookSheet["rows"] }));
}

async function open(
  kind: SmartFileKind,
  bytes: Uint8Array,
  year: number,
): Promise<{ contents: SmartContents; pages: number | null }> {
  const blank = { kind, text: null, lines: null, sheets: null, year };
  if (kind === "pdf") {
    assertPdfSize(bytes);
    const { lines, pages } = await pdfLines(bytes);
    return { contents: { ...blank, lines, text: lines.join("\n") }, pages };
  }
  if (kind === "xlsx") {
    assertZipSize(bytes);
    const sheets = await sheetsOf(bytes);
    return { contents: { ...blank, sheets, text: sheetsText(sheets) }, pages: null };
  }
  if (kind === "png" || kind === "jpg") return { contents: blank, pages: null };
  const text = decodeStatement(bytes);
  return { contents: { ...blank, text, lines: text.split(/\r\n|\r|\n/) }, pages: null };
}

async function work(request: SmartReadRequest): Promise<SmartReadResult> {
  try {
    const { contents, pages } = await open(request.kind, request.bytes, request.year);
    return {
      ok: true,
      text: contents.text?.slice(0, MAX_TEXT_CHARS) ?? null,
      pages,
      reading: recognizeSmartFile(contents),
      peakRssMb: 0,
    };
  } catch (error) {
    if (error instanceof BombError) return { ok: false, failure: "bomba" };
    const { name } = error as { name?: string };
    return { ok: false, failure: name === "PasswordException" ? "senha" : "ilegivel" };
  }
}

function plan({ items, known, sha, scope }: SmartPlanRequest): SmartPlanResult {
  const verdicts = planSmartDuplicates(items, known, {
    shaOf: (id) => sha[id],
    scope: (id) => scope[id] ?? { accountId: null, cardId: null },
  });
  return { ok: true, verdicts: [...verdicts] };
}

const readAll = async (): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

function finish(result: SmartReadResult | SmartPlanResult) {
  process.stdout.write(JSON.stringify(result), () => process.exit(0));
}

async function main() {
  const input = await readAll();
  const size = input.readUInt32LE(0);
  const header = JSON.parse(input.subarray(4, 4 + size).toString("utf8")) as {
    mode: "read" | "plan";
    kind?: SmartFileKind;
    year?: number;
    oldMb: number;
    rssMb: number;
  };
  const body = input.subarray(4 + size);
  const job: ChildJob =
    header.mode === "plan"
      ? { plan: JSON.parse(body.toString("utf8")) as SmartPlanRequest }
      : { read: { kind: header.kind!, year: header.year!, bytes: body } };
  let peak = 0;
  // Fora do heap do V8, em buffer de quem descomprime, o teto de heap não alcança. Este alcança.
  setInterval(() => {
    const rss = process.memoryUsage.rss() / (1024 * 1024);
    peak = Math.max(peak, rss);
    if (rss > header.rssMb) process.exit(MEMORY_EXIT);
  }, WATCH_MS);
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { smartJob: job },
    resourceLimits: { maxOldGenerationSizeMb: header.oldMb, stackSizeMb: 8 },
  });
  worker.on("message", (result: SmartReadResult | SmartPlanResult) => {
    finish(result.ok && "text" in result ? { ...result, peakRssMb: Math.round(peak) } : result);
  });
  worker.on("error", (error: { code?: string }) => {
    if (header.mode === "plan") finish({ ok: false });
    const memory = error.code === "ERR_WORKER_OUT_OF_MEMORY";
    finish({ ok: false, failure: memory ? "bomba" : "ilegivel" });
  });
}

const assigned = isMainThread ? null : (workerData as { smartJob?: ChildJob } | null);
if (assigned?.smartJob) {
  const { read, plan: comparison } = assigned.smartJob;
  parentPort!.postMessage(comparison ? plan(comparison) : await work(read!));
} else if (
  isMainThread &&
  process.argv[1]?.endsWith(path.basename(fileURLToPath(import.meta.url)))
) {
  await main();
}
