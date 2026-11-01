// Arquivos das dívidas (ADR-0019): confere o tipo pelo conteúdo, limpa o nome e compara o que a leitura
// achou com as dívidas que já existem. Puro: o servidor recebe o resultado e decide.
import { decodeStatement, normalizeDescription } from "./statement";
import { money } from "./money";

export const DEBT_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const DEBT_FILES_MAX_BYTES = 50 * 1024 * 1024;
/** Planilha descomprimida acima disto é refugada: protege o servidor de arquivo-bomba. */
export const XLSX_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

export const DEBT_FILE_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
export type DebtFileKind = keyof typeof DEBT_FILE_TYPES;
export const DEBT_FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.csv,.xlsx";

const EXTENSIONS: Record<string, DebtFileKind> = {
  pdf: "pdf",
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  csv: "csv",
  xlsx: "xlsx",
};

const startsWith = (bytes: Uint8Array, signature: number[]) =>
  signature.every((byte, index) => bytes[index] === byte);

const ZIP_END = 0x06054b50;
const ZIP_ENTRY = 0x02014b50;
const ZIP_END_SIZE = 22;
const ZIP_MAX_COMMENT = 0xffff;

/** Nomes e tamanho descomprimido do zip, lidos do diretório central. Null se não for um zip íntegro. */
function zipEntries(bytes: Uint8Array): { names: string[]; uncompressed: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lowest = Math.max(0, bytes.length - ZIP_END_SIZE - ZIP_MAX_COMMENT);
  let end = -1;
  for (let at = bytes.length - ZIP_END_SIZE; at >= lowest; at -= 1) {
    if (view.getUint32(at, true) === ZIP_END) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;
  const total = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const names: string[] = [];
  let uncompressed = 0;
  const decoder = new TextDecoder();
  for (let index = 0; index < total; index += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== ZIP_ENTRY) return null;
    uncompressed += view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    if (at + 46 + nameLength > bytes.length) return null;
    names.push(decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return { names, uncompressed };
}

function isXlsx(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return false;
  const zip = zipEntries(bytes);
  if (!zip || zip.uncompressed > XLSX_MAX_UNCOMPRESSED_BYTES) return false;
  return zip.names.includes("[Content_Types].xml") && zip.names.includes("xl/workbook.xml");
}

const LINE_BREAKS = "\t\r\n";
const isControl = (char: string) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127;

/** Texto de verdade, com separador de colunas, e que não seja HTML ou XML disfarçado. */
function isCsv(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  const text = decodeStatement(bytes);
  if ([...text].some((char) => !LINE_BREAKS.includes(char) && isControl(char))) return false;
  const start = text.trimStart();
  if (start.startsWith("<") || start.startsWith("%PDF")) return false;
  return /[,;\t]/.test(start);
}

const MATCHES: Record<DebtFileKind, (bytes: Uint8Array) => boolean> = {
  pdf: (bytes) => startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]),
  png: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
  csv: isCsv,
  xlsx: isXlsx,
};

const MAX_FILE_NAME = 200;

/** Sem pasta, sem caractere de controle e dentro do limite, mantendo a extensão. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).at(-1) ?? "";
  const clean = [...base]
    .filter((char) => !isControl(char) && char !== '"')
    .join("")
    .trim();
  if (clean.length <= MAX_FILE_NAME) return clean || "arquivo";
  const dot = clean.lastIndexOf(".");
  const extension = dot > 0 ? clean.slice(dot) : "";
  return `${clean.slice(0, MAX_FILE_NAME - extension.length)}${extension}`;
}

export type DebtFileCheck =
  | { ok: true; kind: DebtFileKind; mediaType: string; fileName: string }
  | { ok: false; code: "vazio" | "tamanho" | "tipo"; message: string };

const WRONG_TYPE = "Este arquivo não é um PDF, PNG, JPG, CSV ou Excel (.xlsx) de verdade.";

/** O tipo vale pelo conteúdo. A extensão precisa concordar com ele. */
export function checkDebtFile(bytes: Uint8Array, name: string): DebtFileCheck {
  if (bytes.length === 0) return { ok: false, code: "vazio", message: "O arquivo está vazio." };
  if (bytes.length > DEBT_FILE_MAX_BYTES) {
    return { ok: false, code: "tamanho", message: "O arquivo passa de 10 MB." };
  }
  const fileName = safeFileName(name);
  const extension = fileName.split(".").at(-1)?.toLowerCase() ?? "";
  const kind = EXTENSIONS[extension];
  if (!kind || !MATCHES[kind](bytes)) return { ok: false, code: "tipo", message: WRONG_TYPE };
  return { ok: true, kind, mediaType: DEBT_FILE_TYPES[kind], fileName };
}

export const CONFIDENCE_LEVELS = ["alta", "media", "baixa"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export interface ExtractedField<T> {
  value: T | null;
  confidence: Confidence;
}

/** O que a leitura do arquivo achou. Rascunho: só vira dívida depois da conferência (regra 7). */
export interface DebtExtraction {
  creditor: ExtractedField<string>;
  balance: ExtractedField<string>;
  monthlyRate: ExtractedField<string>;
  installments: ExtractedField<number>;
  installmentAmount: ExtractedField<string>;
  nextDueDate: ExtractedField<string>;
  system: ExtractedField<"price" | "sac">;
  /** Custo efetivo total ao ano, em %. Só informativo: a dívida não guarda. */
  cetAnnual: ExtractedField<string>;
  /** O arquivo parece ter outras dívidas além desta. */
  moreThanOne: boolean;
}

/** Campo que a pessoa precisa olhar com mais atenção. */
export const isDoubtful = (field: ExtractedField<unknown>) =>
  field.value === null || field.confidence !== "alta";

export interface KnownDebt {
  id: string;
  name: string;
  /** Valor da próxima parcela em aberto. */
  nextAmount: string | null;
  openInstallments: number;
}

const MIN_WORD = 4;
const AMOUNT_TOLERANCE = 0.01;
const IGNORED_WORDS = new Set(["banco", "financiamento", "emprestimo", "credito", "cartao"]);

const wordsOf = (text: string) =>
  normalizeDescription(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= MIN_WORD && !IGNORED_WORDS.has(word));

/**
 * Dívida que parece ser a mesma do arquivo: nome em comum com o credor, ou mesma parcela (até 1%) e
 * mesmo número de parcelas. É só uma proposta, a pessoa decide na conferência.
 */
export function matchKnownDebt(found: DebtExtraction, known: KnownDebt[]): KnownDebt | null {
  const creditor = new Set(wordsOf(found.creditor.value ?? ""));
  const byName = known.find((debt) => wordsOf(debt.name).some((word) => creditor.has(word)));
  if (byName) return byName;
  const amount = found.installmentAmount.value;
  const count = found.installments.value;
  if (amount === null || count === null) return null;
  return (
    known.find(
      (debt) =>
        debt.nextAmount !== null &&
        debt.openInstallments === count &&
        money(debt.nextAmount).minus(amount).abs().lte(money(amount).times(AMOUNT_TOLERANCE)),
    ) ?? null
  );
}
