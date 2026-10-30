// Leitura de extratos bancários (OFX e CSV) e conciliação com o que já existe. Sem I/O.
// O conteúdo do arquivo é dado não confiável: nada aqui interpreta instruções, só valores.
import { money, toDbAmount, type MoneyValue } from "./money";

export type StatementKind = "receita" | "despesa";
export type StatementSource = "ofx" | "csv";

export interface StatementRow {
  date: string;
  description: string;
  /** Sempre positivo; o sentido está em `kind`. */
  amount: string;
  kind: StatementKind;
  /** Identificador dado pelo banco, quando existe. */
  externalId?: string;
}

export interface ParsedStatement {
  rows: StatementRow[];
  skipped: number;
}

export type FingerprintedRow = StatementRow & { fingerprint: string };

/** Tira acentos, números e pontuação para comparar descrições. */
export function normalizeDescription(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

const dropBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

function cleanDescription(text: string): string {
  const cleaned = text
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return cleaned || "Sem descrição";
}

/** Bancos brasileiros ainda exportam em Windows-1252; UTF-8 inválido cai nele. */
export function decodeStatement(bytes: Uint8Array): string {
  try {
    return dropBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Aceita 1.234,56 · 1,234.56 · 1234.56 · -R$ 10,00 · (10,00) · 10,00- · 10,00 D. */
export function parseStatementAmount(raw: string): MoneyValue | null {
  let text = raw.trim();
  if (!text) return null;
  let negative = false;
  const flag = text.match(/\s*([DC])$/i);
  if (flag) {
    negative = flag[1]!.toUpperCase() === "D";
    text = text.slice(0, flag.index).trim();
  }
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.includes("-")) negative = true;

  const digits = text.replace(/[^\d.,]/g, "");
  if (!/\d/.test(digits)) return null;
  const comma = digits.lastIndexOf(",");
  const dot = digits.lastIndexOf(".");
  let plain: string;
  if (comma >= 0 && dot >= 0) {
    const separator = comma > dot ? "," : ".";
    const other = separator === "," ? "." : ",";
    plain = digits.split(other).join("").replace(separator, ".");
  } else if (comma >= 0) {
    plain = digits.replace(/,(?=.*,)/g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(digits)) {
    plain = digits.split(".").join("");
  } else {
    plain = digits;
  }
  if (!/^\d+(\.\d+)?$/.test(plain)) return null;
  const value = money(plain);
  return negative ? value.negated() : value;
}

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Aceita 31/10/2026, 31/10/26, 31-10-2026, 2026-10-31 e 20261031 (OFX). */
export function parseStatementDate(raw: string): string | null {
  const text = raw.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})(\d{6})?(\.\d+)?(\[.*\])?$/);
  if (compact) return validDate(Number(compact[1]), Number(compact[2]), Number(compact[3]));
  const br = text.match(/^(\d{2})[/.-](\d{2})[/.-](\d{4}|\d{2})\b/);
  if (br) {
    const year = br[3]!.length === 2 ? 2000 + Number(br[3]) : Number(br[3]);
    return validDate(year, Number(br[2]), Number(br[1]));
  }
  return null;
}

function buildRow(
  date: string | null,
  description: string,
  value: MoneyValue | null,
  externalId?: string,
): StatementRow | null {
  if (!date || !value || value.isZero()) return null;
  const amount = toDbAmount(value.abs());
  if (money(amount).isZero()) return null;
  return {
    date,
    description: cleanDescription(description),
    amount,
    kind: value.isNegative() ? "despesa" : "receita",
    ...(externalId ? { externalId } : {}),
  };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function ofxTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  return match ? decodeEntities(match[1]!).trim() : "";
}

/** OFX 1.x (SGML, sem tags de fechamento) e 2.x (XML). */
export function parseOfx(text: string): ParsedStatement {
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|$)/gi);
  if (!blocks) throw new RangeError("Não encontramos lançamentos neste arquivo OFX.");
  const rows: StatementRow[] = [];
  let skipped = 0;
  for (const block of blocks) {
    const row = buildRow(
      parseStatementDate(ofxTag(block, "DTPOSTED")),
      ofxTag(block, "MEMO") || ofxTag(block, "NAME"),
      parseStatementAmount(ofxTag(block, "TRNAMT")),
      ofxTag(block, "FITID"),
    );
    if (row) rows.push(row);
    else skipped += 1;
  }
  return { rows, skipped };
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

export function parseCsvTable(text: string): string[][] {
  const lines = dropBom(text)
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim().length > 0);
  const sample = lines.slice(0, 20);
  const delimiter = [";", "\t", ","].reduce((best, candidate) => {
    const score = (d: string) => sample.filter((line) => splitCsvLine(line, d).length > 2).length;
    return score(candidate) > score(best) ? candidate : best;
  }, ";");
  return lines.map((line) => splitCsvLine(line, delimiter));
}

export interface CsvMapping {
  /** Linha do cabeçalho, ou -1 quando o arquivo não tem. */
  header: number;
  date: number;
  description: number;
  /** Coluna única com sinal, ou então `credit` e `debit` separadas. */
  amount: number;
  credit: number;
  debit: number;
  id: number;
}

const headerName = (cell: string) => normalizeDescription(cell);

function findColumn(row: string[], matches: (name: string) => boolean): number {
  return row.findIndex((cell) => matches(headerName(cell)));
}

function mappingFromHeader(row: string[], header: number): CsvMapping | null {
  const date = findColumn(row, (n) => n.startsWith("data") || n === "date" || n === "dt");
  const amount = findColumn(
    row,
    (n) =>
      (n.startsWith("valor") || n === "amount" || n === "value" || n === "quantia") &&
      !n.includes("saldo"),
  );
  const credit = findColumn(row, (n) => n.startsWith("credito") || n.startsWith("entrada"));
  const debit = findColumn(row, (n) => n.startsWith("debito") || n.startsWith("saida"));
  if (date < 0 || (amount < 0 && (credit < 0 || debit < 0))) return null;
  const description = findColumn(
    row,
    (n) =>
      n.startsWith("descri") ||
      n.startsWith("histor") ||
      n.startsWith("lancamento") ||
      n === "title" ||
      n.startsWith("titulo") ||
      n === "memo" ||
      n.startsWith("detalhe") ||
      n.startsWith("estabelecimento"),
  );
  const id = findColumn(row, (n) => n.startsWith("identificador") || n === "id");
  return { header, date, description, amount, credit, debit, id };
}

/** Sem cabeçalho reconhecido, deduz as colunas pelo conteúdo das linhas. */
function mappingFromContent(table: string[][]): CsvMapping | null {
  const sample = table.slice(0, 15);
  const width = Math.max(0, ...sample.map((row) => row.length));
  const share = (test: (cell: string) => boolean, column: number) =>
    sample.filter((row) => test(row[column] ?? "")).length / Math.max(1, sample.length);
  const isDate = (cell: string) => parseStatementDate(cell) !== null;
  const isAmount = (cell: string) => /\d/.test(cell) && parseStatementAmount(cell) !== null;

  let date = -1;
  let amount = -1;
  let description = -1;
  for (let column = 0; column < width; column += 1) {
    if (date < 0 && share(isDate, column) >= 0.6) date = column;
  }
  for (let column = width - 1; column >= 0; column -= 1) {
    if (amount < 0 && column !== date && share(isAmount, column) >= 0.6) amount = column;
  }
  for (let column = 0; column < width; column += 1) {
    if (column === date || column === amount) continue;
    if (description < 0 && share((cell) => /[a-zà-ú]{3}/i.test(cell), column) >= 0.5)
      description = column;
  }
  if (date < 0 || amount < 0) return null;
  return { header: -1, date, description, amount, credit: -1, debit: -1, id: -1 };
}

/** Procura o cabeçalho nas primeiras linhas: bancos costumam pôr um título antes. */
export function detectCsvMapping(table: string[][]): CsvMapping | null {
  for (let index = 0; index < Math.min(15, table.length); index += 1) {
    const mapping = mappingFromHeader(table[index]!, index);
    if (mapping) return mapping;
  }
  return mappingFromContent(table);
}

export function csvRows(table: string[][], mapping: CsvMapping): ParsedStatement {
  const rows: StatementRow[] = [];
  let skipped = 0;
  for (const cells of table.slice(mapping.header + 1)) {
    const text = (column: number) => (column >= 0 ? (cells[column] ?? "") : "");
    const description = text(mapping.description);
    if (/^saldo\b/i.test(description)) {
      skipped += 1;
      continue;
    }
    let value: MoneyValue | null;
    if (mapping.amount >= 0) {
      value = parseStatementAmount(text(mapping.amount));
    } else {
      const credit = parseStatementAmount(text(mapping.credit));
      const debit = parseStatementAmount(text(mapping.debit));
      value = credit && !credit.isZero() ? credit.abs() : debit ? debit.abs().negated() : null;
    }
    const row = buildRow(
      parseStatementDate(text(mapping.date)),
      description,
      value,
      text(mapping.id) || undefined,
    );
    if (row) rows.push(row);
    else skipped += 1;
  }
  return { rows, skipped };
}

/**
 * Identidade estável da linha para reimportar sem duplicar. Sem identificador do banco, usa
 * data, valor e descrição, com um contador para manter duas compras iguais no mesmo dia.
 */
export function withFingerprints(
  rows: StatementRow[],
  source: StatementSource,
): FingerprintedRow[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = row.externalId
      ? `${source}:id:${row.externalId}`
      : `${source}:${row.date}|${row.kind}|${row.amount}|${normalizeDescription(row.description)}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { ...row, fingerprint: `${base}#${count}`.slice(0, 300) };
  });
}

export type RowState = "novo" | "previsto" | "lancado" | "importado";

export interface KnownEntry {
  key: string;
  description: string;
  amount: string;
  date: string;
  kind: StatementKind;
  fingerprint?: string | null;
}

export type ReconciledRow = FingerprintedRow & { state: RowState; match: KnownEntry | null };

const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

function takeClosest(row: StatementRow, pool: KnownEntry[], window: number): KnownEntry | null {
  let best = -1;
  let bestGap = Infinity;
  pool.forEach((entry, index) => {
    if (entry.kind !== row.kind || !money(entry.amount).equals(row.amount)) return;
    const gap = Math.abs(dayOf(entry.date) - dayOf(row.date));
    if (gap <= window && gap < bestGap) {
      best = index;
      bestGap = gap;
    }
  });
  return best < 0 ? null : (pool.splice(best, 1)[0] ?? null);
}

/**
 * Classifica cada linha. `importado` já está no sistema; `previsto` dá baixa numa previsão de
 * valor igual até 5 dias de distância; `lancado` parece repetir um lançamento até 3 dias.
 * Cada lançamento ou previsão é usado por uma linha só.
 */
export function reconcileRows(
  rows: FingerprintedRow[],
  known: { realized: KnownEntry[]; forecasts: KnownEntry[] },
): ReconciledRow[] {
  const realized = [...known.realized];
  const forecasts = [...known.forecasts];
  const imported = new Set(realized.map((entry) => entry.fingerprint).filter(Boolean));

  const fresh = rows.filter((row) => !imported.has(row.fingerprint));
  for (const row of rows) {
    if (!imported.has(row.fingerprint)) continue;
    const index = realized.findIndex((entry) => entry.fingerprint === row.fingerprint);
    if (index >= 0) realized.splice(index, 1);
  }

  const results = new Map<string, ReconciledRow>();
  for (const row of fresh) {
    const forecast = takeClosest(row, forecasts, 5);
    if (forecast) {
      results.set(row.fingerprint, { ...row, state: "previsto", match: forecast });
      continue;
    }
    const twin = takeClosest(row, realized, 3);
    results.set(row.fingerprint, { ...row, state: twin ? "lancado" : "novo", match: twin });
  }
  return rows.map(
    (row) => results.get(row.fingerprint) ?? { ...row, state: "importado", match: null },
  );
}

const MONEY = /[-+]?\s*(?:R\$\s*)?[-+]?\d{1,3}(?:\.\d{3})*,\d{2}(?:\s*[-+DC])?(?![\d,])/g;
const INCOME_WORDS =
  /recebid|credito|deposito|salario|rendimento|estorno|reembolso|resgate|\bted rec|\bpix rec/;

function pdfAmount(token: string, description: string): MoneyValue | null {
  const value = parseStatementAmount(token.replace(/\s+/g, " ").replace(/^\+\s*/, ""));
  if (!value) return null;
  const signed = /-|\bD$/i.test(token) || /\bC$/i.test(token) || token.trim().startsWith("+");
  if (signed) return value;
  // Sem sinal, a descrição decide. A família confere antes de importar.
  return INCOME_WORDS.test(normalizeDescription(description)) ? value : value.negated();
}

/**
 * Extrato em PDF: cada linha com data no início e valor no fim vira lançamento. Com dois valores
 * no fim, o último é o saldo. Data sem ano usa `year`. Linhas de saldo e totais ficam de fora.
 */
export function parsePdfLines(lines: string[], year: number): ParsedStatement {
  const rows: StatementRow[] = [];
  let skipped = 0;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    const date = line.match(/^(\d{2})[/.-](\d{2})(?:[/.-](\d{4}|\d{2}))?\b/);
    if (!date) continue;
    const tokens = [...line.matchAll(MONEY)];
    const first = tokens.length >= 2 ? tokens.at(-2)! : tokens.at(-1);
    if (!first) continue;
    const description = line.slice(date[0].length, first.index).trim();
    if (!description || /^(saldo|total|s\s*a\s*l\s*d\s*o)\b/i.test(description)) {
      skipped += 1;
      continue;
    }
    const full = date[3] ?? String(year);
    const row = buildRow(
      parseStatementDate(`${date[1]}/${date[2]}/${full}`),
      description,
      pdfAmount(first[0], description),
    );
    if (row) rows.push(row);
    else skipped += 1;
  }
  return { rows, skipped };
}
