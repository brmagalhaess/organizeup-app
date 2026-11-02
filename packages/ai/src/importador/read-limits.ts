// Contas de bomba e texto de planilha (ADR-0030). Rodam dentro do processo isolado. O que o arquivo declara serve
// só para achar as entradas: o limite é sempre sobre os bytes que saem do inflador.
import { inflateRawSync, inflateSync } from "node:zlib";
import {
  isValidCnpj,
  isValidCpf,
  SMART_PDF_MAX_INFLATED,
  SMART_ZIP_MAX_INFLATED,
  type WorkbookSheet,
} from "@organizeup/domain";

const ZIP_END = 0x06054b50;
const ZIP_ENTRY = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const ZIP_END_SIZE = 22;
const ZIP_MAX_COMMENT = 0xffff;
const STORED = 0;
const DEFLATED = 8;
/** `Z_SYNC_FLUSH`: dado cortado não é erro aqui, o que importa é quanto saiu. */
const SYNC_FLUSH = 2;

export class BombError extends Error {}

const tooLarge = (error: unknown) => (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE";

function zipEnd(buffer: Buffer): number {
  const lowest = Math.max(0, buffer.length - ZIP_END_SIZE - ZIP_MAX_COMMENT);
  for (let at = buffer.length - ZIP_END_SIZE; at >= lowest; at -= 1) {
    if (buffer.readUInt32LE(at) === ZIP_END) return at;
  }
  throw new BombError("zip");
}

/** Infla cada entrada de verdade, contando o que sai. Tamanho mentiroso no diretório não muda a conta. */
export function assertZipSize(bytes: Uint8Array, limit = SMART_ZIP_MAX_INFLATED): void {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = zipEnd(buffer);
  const total = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  let inflated = 0;
  for (let index = 0; index < total; index += 1) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== ZIP_ENTRY) {
      throw new BombError("zip");
    }
    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== ZIP_LOCAL) {
      throw new BombError("zip");
    }
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    // Tamanho zero no diretório não esconde nada: lê até o fim, e o inflador para sozinho.
    const stop = compressed > 0 ? Math.min(start + compressed, buffer.length) : buffer.length;
    const data = buffer.subarray(start, stop);
    if (method === STORED) inflated += data.length;
    else if (method !== DEFLATED) throw new BombError("zip");
    else {
      try {
        inflated += inflateRawSync(data, {
          maxOutputLength: limit - inflated + 1,
          finishFlush: SYNC_FLUSH,
        }).length;
      } catch (error) {
        if (tooLarge(error)) throw new BombError("zip");
      }
    }
    if (inflated > limit) throw new BombError("zip");
    at += 46 + nameLength + extraLength + commentLength;
  }
}

const STREAM = Buffer.from("stream");
const END_STREAM = Buffer.from("endstream");
/** Primeiro byte de um fluxo zlib com a janela padrão. */
const ZLIB_HEADER = 0x78;

/**
 * O pdf.js infla sem limite, e um PDF de 10 MB pode dar 10 GB. Antes de abrir, cada fluxo é inflado com teto na
 * saída. Fluxo cifrado ou com outro filtro passa daqui, e fica para o vigia de memória.
 */
export function assertPdfSize(bytes: Uint8Array, limit = SMART_PDF_MAX_INFLATED): void {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let inflated = 0;
  let at = buffer.indexOf(STREAM);
  while (at >= 0) {
    let start = at + STREAM.length;
    if (buffer[start] === 13) start += 1;
    if (buffer[start] === 10) start += 1;
    const close = buffer.indexOf(END_STREAM, start);
    if (close < 0) break;
    if (buffer[start] === ZLIB_HEADER) {
      try {
        inflated += inflateSync(buffer.subarray(start, close), {
          maxOutputLength: limit - inflated + 1,
          finishFlush: SYNC_FLUSH,
        }).length;
      } catch (error) {
        if (tooLarge(error)) throw new BombError("pdf");
      }
      if (inflated > limit) throw new BombError("pdf");
    }
    at = buffer.indexOf(STREAM, close + END_STREAM.length);
  }
}

/** Planilha guarda CPF como número e perde o zero à esquerda: "01234567890" vira 1234567890. */
function numericDocument(value: number): boolean {
  if (!Number.isSafeInteger(value) || value < 0) return false;
  const digits = String(value);
  if (digits.length >= 8 && digits.length <= 11 && isValidCpf(digits.padStart(11, "0"))) {
    return true;
  }
  return digits.length >= 11 && digits.length <= 14 && isValidCnpj(digits.padStart(14, "0"));
}

const sheetCell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && numericDocument(value)) return "[documento]";
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
