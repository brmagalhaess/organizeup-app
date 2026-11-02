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

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:\\w+:)?${name}>`, "i").exec(
    block,
  );
  return match ? decodeXml(match[1]!).trim() : null;
}

function group(block: string, name: string): string | null {
  const match = new RegExp(
    `<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`,
    "i",
  ).exec(block);
  return match ? match[1]! : null;
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

const productsOf = (block: string) =>
  [...block.matchAll(/<(?:\w+:)?xProd>([^<]*)</gi)]
    .slice(0, MAX_PRODUCTS)
    .map((match) => decodeXml(match[1]!).trim())
    .filter(Boolean);

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
