// NF-e e CF-e-SAT em XML (ADR-0030). Puro, sem biblioteca de XML: lê marcas por expressão regular, então não
// há entidade a resolver nem rede a acessar. `checkSmartFile` já recusou DOCTYPE. CNPJ e CPF de emitente e
// destinatário nunca são lidos: importa quem vendeu, quando e quanto.
//
// Fontes das marcas: Manual de Orientação do Contribuinte da NF-e (grupos ide, emit, total/ICMSTot, dhEmi,
// vNF) e Especificação de Requisitos do SAT (grupos infCFe, ide/dEmi, emit, total/vCFe), conferidas de memória
// de layout público. Falta conferir com arquivo real.
import { toDbAmount, money } from "./money";
import { fitsAmount } from "./fx";
import { parseStatementAmount, parseStatementDate } from "./statement";

export interface FiscalNote {
  kind: "nfe" | "cfe";
  /** Razão social de quem vendeu. */
  issuer: string | null;
  date: string;
  total: string;
  /** Primeiros produtos, para a descrição. */
  products: string[];
}

const MAX_PRODUCTS = 3;

const MAX_PREFIX = 32;
const isNameChar = (code: number) =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

/** Antes do nome vem `<`, `</` ou o prefixo do namespace. Olha para trás no máximo o tamanho de um prefixo. */
function markStart(text: string, at: number, closing: boolean): number {
  let index = at - 1;
  if (text[index] === ":") {
    const limit = Math.max(0, index - MAX_PREFIX);
    index -= 1;
    while (index >= limit && isNameChar(text.charCodeAt(index))) index -= 1;
  }
  if (closing) return text[index] === "/" && text[index - 1] === "<" ? index - 1 : -1;
  return text[index] === "<" ? index : -1;
}

/** Abertura de `name` a partir de `from`: varredura linear, sem expressão regular. */
function findOpen(text: string, name: string, from: number): { start: number; end: number } | null {
  for (let at = text.indexOf(name, from); at >= 0; at = text.indexOf(name, at + name.length)) {
    const after = text[at + name.length];
    if (after !== ">" && after !== " " && after !== "\t" && after !== "\r" && after !== "\n") {
      continue;
    }
    const start = markStart(text, at, false);
    if (start < 0) continue;
    const end = text.indexOf(">", at + name.length);
    if (end < 0) return null;
    return { start, end: end + 1 };
  }
  return null;
}

function findClose(text: string, name: string, from: number): number {
  const mark = `${name}>`;
  for (let at = text.indexOf(mark, from); at >= 0; at = text.indexOf(mark, at + mark.length)) {
    const start = markStart(text, at, true);
    if (start >= 0) return start;
  }
  return -1;
}

/** Conteúdo do primeiro `name`, e onde ele acaba. */
function section(block: string, name: string, from = 0): { inner: string; next: number } | null {
  const open = findOpen(block, name, from);
  if (!open) return null;
  const close = findClose(block, name, open.end);
  return close < 0 ? null : { inner: block.slice(open.end, close), next: close };
}

const group = (block: string, name: string): string | null => section(block, name)?.inner ?? null;

function tag(block: string, name: string): string | null {
  const inner = group(block, name);
  return inner === null || inner.includes("<") ? null : decodeXml(inner).trim();
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function totalOf(raw: string | null): string | null {
  if (!raw || !/^\d{1,13}(\.\d{1,2})?$/.test(raw.trim())) return null;
  const value = money(raw.trim());
  return value.gt(0) && fitsAmount(value.toFixed(2)) ? toDbAmount(value) : null;
}

function productsOf(block: string): string[] {
  const found: string[] = [];
  let from = 0;
  while (found.length < MAX_PRODUCTS) {
    const product = section(block, "xProd", from);
    if (!product) break;
    from = product.next;
    const name = decodeXml(product.inner).trim();
    if (name && !name.includes("<")) found.push(name);
  }
  return found;
}

/** Null: não é NF-e nem CF-e, ou falta data ou total. */
export function parseFiscalXml(text: string): FiscalNote | null {
  const nfe = group(text, "infNFe");
  if (nfe) {
    const date = parseStatementDate(
      (tag(group(nfe, "ide") ?? "", "dhEmi") ?? tag(group(nfe, "ide") ?? "", "dEmi") ?? "").slice(
        0,
        10,
      ),
    );
    const total = totalOf(tag(group(nfe, "ICMSTot") ?? "", "vNF"));
    if (!date || !total) return null;
    return {
      kind: "nfe",
      issuer: tag(group(nfe, "emit") ?? "", "xNome"),
      date,
      total,
      products: productsOf(nfe),
    };
  }
  const cfe = group(text, "infCFe");
  if (cfe) {
    const date = parseStatementDate(tag(group(cfe, "ide") ?? "", "dEmi") ?? "");
    const total = totalOf(tag(group(cfe, "total") ?? "", "vCFe"));
    if (!date || !total) return null;
    return {
      kind: "cfe",
      issuer: tag(group(cfe, "emit") ?? "", "xNome"),
      date,
      total,
      products: productsOf(cfe),
    };
  }
  return null;
}

/** OFX diz se é conta ou cartão, e às vezes quem emitiu. */
export function ofxHints(text: string): { card: boolean; issuer: string | null } {
  const org = /<ORG>([^<\r\n]+)/i.exec(text)?.[1]?.trim() ?? null;
  return { card: /<CREDITCARDMSGSRSV1>|<CCSTMTRS>/i.test(text), issuer: org };
}

export const looksLikeOfx = (text: string) => /<OFX[\s>]|^\s*OFXHEADER:/i.test(text);

export const statementAmountOf = parseStatementAmount;
