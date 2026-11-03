// Identificação sem IA (ADR-0030): os parsers que já existem, em ordem. Quem reconhece responde; ninguém
// responde, e o arquivo vai para o modelo, se a família permitiu. Puro: recebe o arquivo já aberto.
import { parseB3Workbook, type WorkbookSheet } from "./b3-spreadsheet";
import { parseBrokerageNotes } from "./brokerage-note";
import { parseFiscalXml, looksLikeOfx, ofxHints } from "./fiscal-xml";
import {
  DividendFileError,
  parseDividendFile,
  type DividendFileInput,
  type ParsedDividendFile,
} from "./dividend-file";
import {
  cleanFileText,
  INVESTMENT_FILE_MAX_LINES,
  type ParsedInvestmentFile,
} from "./investment-file";
import {
  SMART_MAX_ITEMS_PER_FILE,
  smartNote,
  safeText,
  type SmartDocType,
  type SmartFileKind,
  type SmartProposal,
  type SmartReading,
} from "./smart-import";
import {
  csvRows,
  detectCsvMapping,
  normalizeDescription,
  parseCsvTable,
  parseOfx,
  parsePdfLines,
  withFingerprints,
  type FingerprintedRow,
  type StatementRow,
  type StatementSource,
} from "./statement";
import { maskDocuments } from "./documents";

/** O arquivo aberto, sem nada interpretado. O que não se aplica ao tipo vem nulo. */
export interface SmartContents {
  kind: SmartFileKind;
  text: string | null;
  /** Linhas de texto do PDF, ou do TXT. */
  lines: string[] | null;
  sheets: WorkbookSheet[] | null;
  /** Ano para data sem ano no PDF. */
  year: number;
}

export type SmartRecognizer = (contents: SmartContents) => SmartReading | null;

const ISSUERS: Array<[RegExp, string]> = [
  [/\bnubank\b|\bnu pagamentos\b/, "Nubank"],
  [/\bita[uú]\b/, "Itaú"],
  [/\bbradesco\b/, "Bradesco"],
  [/\bsantander\b/, "Santander"],
  [/\bbanco do brasil\b/, "Banco do Brasil"],
  [/\bcaixa economica\b/, "Caixa"],
  [/\bbanco inter\b/, "Inter"],
  [/\bc6 bank\b/, "C6 Bank"],
  [/\bbtg\b/, "BTG"],
  [/\bxp investimentos\b/, "XP"],
  [/\bsicredi\b/, "Sicredi"],
  [/\bsicoob\b/, "Sicoob"],
  [/\bmercado pago\b/, "Mercado Pago"],
  [/\bpicpay\b/, "PicPay"],
];

function issuerIn(text: string): string | null {
  const plain = text.slice(0, 4000).toLowerCase();
  return ISSUERS.find(([pattern]) => pattern.test(plain))?.[1] ?? null;
}

const entries = (
  rows: FingerprintedRow[],
  source: StatementSource,
  confidence: SmartReading["confidence"],
): SmartProposal[] =>
  rows.map((row) => ({
    confidence,
    excerpt: `${row.date} ${maskDocuments(row.description, "[documento]")} ${row.amount}`,
    payload: {
      destination: "lancamento",
      date: row.date,
      description: statementText(row),
      amount: row.amount,
      kind: row.kind,
      fingerprint: row.fingerprint,
      source,
      accountId: null,
      matchKey: null,
      matchMonth: null,
      categoryId: null,
      newCategory: null,
      categorySource: null,
    },
  }));

/** Descrição de extrato no cadastro: sem CPF e sem fórmula. Link e ordem somem, como no resto. */
const statementText = (row: StatementRow) =>
  safeText(row.description, 120) ?? (cleanFileText(row.description, 120) ? null : "Sem descrição");

const purchases = (
  rows: FingerprintedRow[],
  confidence: SmartReading["confidence"],
): SmartProposal[] =>
  rows.map((row) => ({
    confidence,
    excerpt: `${row.date} ${maskDocuments(row.description, "[documento]")} ${row.amount}`,
    payload: {
      destination: "compra_cartao",
      date: row.date,
      description: statementText(row),
      amount: row.amount,
      // Cada linha da fatura é a parcela do mês: importar como parcelada contaria de novo a cada mês.
      installments: 1,
      fingerprint: row.fingerprint,
      cardId: null,
      categoryId: null,
      newCategory: null,
      categorySource: null,
    },
  }));

function statementReading(input: {
  rows: StatementRow[];
  skipped: number;
  source: StatementSource;
  card: boolean;
  issuer: string | null;
  confidence: SmartReading["confidence"];
}): SmartReading {
  const { source, card, issuer, confidence, skipped } = input;
  const kept = card ? input.rows.filter((row) => row.kind === "despesa") : input.rows;
  const rows = withFingerprints(kept, source);
  const ignored = skipped + input.rows.length - kept.length;
  return {
    docType: card ? "fatura" : "extrato",
    issuer,
    confidence,
    proposals: card ? purchases(rows, confidence) : entries(rows, source, confidence),
    fields: [],
    notes: ignored > 0 ? [smartNote("linhas_ignoradas", ignored)] : [],
  };
}

const recognizeOfx: SmartRecognizer = ({ text }) => {
  if (!text || !looksLikeOfx(text)) return null;
  try {
    const { rows, skipped } = parseOfx(text);
    const { card, issuer } = ofxHints(text);
    return statementReading({
      rows,
      skipped,
      source: "ofx",
      card,
      issuer: safeText(issuer, 80) ?? issuerIn(text),
      confidence: "alta",
    });
  } catch {
    return null;
  }
};

const recognizeFiscal: SmartRecognizer = ({ text, kind }) => {
  if (!text || kind !== "xml") return null;
  const note = parseFiscalXml(text);
  if (!note) return null;
  const issuer = safeText(note.issuer, 80);
  const products = note.products.map((product) => safeText(product, 60)).filter(Boolean);
  const description = issuer ?? products[0] ?? null;
  return {
    docType: "nota_fiscal",
    issuer,
    confidence: "alta",
    proposals: [
      {
        confidence: "alta",
        excerpt: [issuer, ...products].filter(Boolean).join(" · ").slice(0, 300) || null,
        payload: {
          destination: "lancamento",
          date: note.date,
          description,
          amount: note.total,
          kind: "despesa",
          fingerprint: null,
          source: "csv",
          accountId: null,
          matchKey: null,
          matchMonth: null,
          categoryId: null,
          newCategory: null,
          categorySource: null,
        },
      },
    ],
    fields: products.map((product, index) => ({
      label: `Produto ${index + 1}`,
      value: product!,
    })),
    notes: [],
  };
};

function tradeReading(parsed: ParsedInvestmentFile, docType: SmartDocType): SmartReading {
  const proposals: SmartProposal[] = parsed.trades.map((trade) => ({
    confidence: trade.doubt ? "baixa" : "alta",
    excerpt:
      `${trade.date} ${trade.ticker ?? trade.title ?? ""} ${trade.quantity} × ${trade.unitPrice}`.slice(
        0,
        300,
      ),
    payload: {
      destination: "operacao",
      line: trade.line,
      ticker: trade.ticker,
      title: trade.title,
      side: trade.side,
      date: trade.date,
      quantity: trade.quantity,
      unitPrice: trade.unitPrice,
      fees: trade.fees,
      doubt: trade.doubt,
      accountId: null,
    },
  }));
  const notes = [
    ...(parsed.ignored.length > 0 ? [smartNote("linhas_ignoradas", parsed.ignored.length)] : []),
    ...(parsed.positions.length > 0 ? [smartNote("posicao", parsed.positions.length)] : []),
  ];
  return {
    docType,
    issuer: docType === "negociacao_b3" ? "B3" : null,
    confidence: "alta",
    proposals,
    fields: [],
    notes,
  };
}

const recognizeB3: SmartRecognizer = ({ sheets }) => {
  if (!sheets) return null;
  try {
    return tradeReading(parseB3Workbook(sheets), "negociacao_b3");
  } catch {
    return null;
  }
};

const recognizeNote: SmartRecognizer = ({ lines, kind }) => {
  if (kind !== "pdf" || !lines) return null;
  try {
    return tradeReading(parseBrokerageNotes(lines), "nota_corretagem");
  } catch {
    return null;
  }
};

function dividendReading(parsed: ParsedDividendFile, cut: number | null): SmartReading {
  const proposals: SmartProposal[] = parsed.rows.map((row) => ({
    confidence: row.ambiguous ? "baixa" : "alta",
    excerpt: `${row.paidOn} ${row.ticker} ${row.net ?? row.gross ?? ""}`.trim(),
    payload: {
      destination: "provento",
      line: row.line,
      ticker: row.ticker,
      kind: row.kind,
      date: row.paidOn,
      gross: row.gross,
      withheld: row.withheld,
      net: row.net,
      ...(row.ambiguous ? { ambiguous: true } : {}),
    },
  }));
  return {
    docType: "proventos",
    issuer: parsed.kind === "csv" ? null : "B3",
    confidence: "alta",
    proposals,
    fields: [],
    notes: [
      ...(parsed.ignored.length > 0 ? [smartNote("linhas_ignoradas", parsed.ignored.length)] : []),
      ...(cut === null ? [] : [smartNote("itens_cortados", cut)]),
    ],
  };
}

/** Arquivo que é de proventos e passa do limite do parser entra pela metade, e nunca vira lançamento. */
function parseDividends(
  input: DividendFileInput,
  cutInput: () => DividendFileInput,
  total: number,
) {
  try {
    return dividendReading(parseDividendFile(input), null);
  } catch (error) {
    if (!(error instanceof DividendFileError) || error.code !== "muitas_linhas") return null;
  }
  try {
    return dividendReading(parseDividendFile(cutInput()), total);
  } catch {
    return null;
  }
}

const countLines = (text: string) => text.split(/\r\n|\r|\n/).length;

const recognizeDividendCsv: SmartRecognizer = ({ text, kind }) => {
  if (!text || (kind !== "csv" && kind !== "txt")) return null;
  const cut = () => ({
    format: "csv" as const,
    text: text
      .split(/\r\n|\r|\n/)
      .slice(0, INVESTMENT_FILE_MAX_LINES)
      .join("\n"),
  });
  return parseDividends({ format: "csv", text }, cut, countLines(text));
};

/** Recebidos vem antes da B3; Movimentação, depois, para operação seguir sendo operação (ADR-0024). */
const dividendSheet =
  (only: ParsedDividendFile["kind"] | null): SmartRecognizer =>
  ({ sheets }) => {
    if (!sheets) return null;
    const rows = sheets.reduce((acc, sheet) => acc + sheet.rows.length, 0);
    const cut = () => ({
      format: "xlsx" as const,
      sheets: sheets.map((sheet) => ({
        ...sheet,
        rows: sheet.rows.slice(0, INVESTMENT_FILE_MAX_LINES),
      })),
    });
    const reading = parseDividends({ format: "xlsx", sheets }, cut, rows);
    if (!reading) return null;
    return only === null || reading.issuer === "B3" ? reading : null;
  };

const recebidos = (sheets: WorkbookSheet[]) =>
  sheets.some((sheet) =>
    sheet.rows.slice(0, 15).some((row) => {
      const names = row.map((cell) => normalizeDescription(String(cell ?? "")));
      return names.includes("tipo de evento") && names.includes("valor liquido");
    }),
  );

const recognizeDividendRecebidos: SmartRecognizer = (contents) =>
  contents.sheets && recebidos(contents.sheets) ? dividendSheet("recebidos")(contents) : null;

const cardHeader = (table: string[][], header: number) => {
  const names = (table[Math.max(header, 0)] ?? []).map(normalizeDescription);
  return names.includes("title") || names.some((name) => name.startsWith("estabelecimento"));
};

function tableReading(table: string[][], source: StatementSource, text: string) {
  const mapping = detectCsvMapping(table);
  if (!mapping) return null;
  const { rows, skipped } = csvRows(table, mapping);
  const minimum = mapping.header < 0 ? 2 : 1;
  if (rows.length < minimum || rows.length < skipped) return null;
  // Fatura em CSV traz a compra positiva. Mais de quatro em cinco positivas e coluna de estabelecimento: é
  // fatura. Fora disso fica extrato, e a família confere na revisão.
  const positive = rows.filter((row) => row.kind === "receita").length;
  const card = cardHeader(table, mapping.header) && positive * 5 >= rows.length * 4;
  return statementReading({
    rows: card
      ? rows.map((row) => ({ ...row, kind: row.kind === "receita" ? "despesa" : "receita" }))
      : rows,
    skipped,
    source,
    card,
    issuer: issuerIn(text),
    confidence: mapping.header < 0 ? "media" : "alta",
  });
}

const recognizeSheet: SmartRecognizer = ({ sheets }) => {
  const first = sheets?.[0];
  if (!first) return null;
  const table = first.rows
    .map((row) =>
      row.map((cell) => {
        if (cell === null || cell === undefined) return "";
        if (cell instanceof Date) return cell.toISOString().slice(0, 10);
        return String(cell);
      }),
    )
    .filter((row) => row.some((cell) => cell.trim().length > 0));
  return tableReading(table, "csv", table.flat().slice(0, 200).join(" "));
};

const recognizeCsv: SmartRecognizer = ({ text, kind }) => {
  if (!text || (kind !== "csv" && kind !== "txt")) return null;
  return tableReading(parseCsvTable(text), "csv", text);
};

const STATEMENT_WORDS = /\b(extrato|saldo|fatura|lancamentos|movimentacao)\b/;

const recognizeLines: SmartRecognizer = ({ lines, kind, year }) => {
  if ((kind !== "pdf" && kind !== "txt") || !lines) return null;
  const joined = lines.join("\n");
  const plain = normalizeDescription(joined.slice(0, 6000));
  if (!STATEMENT_WORDS.test(plain)) return null;
  const { rows, skipped } = parsePdfLines(lines, year);
  if (rows.length < 3) return null;
  return statementReading({
    rows,
    skipped,
    source: "csv",
    card: /\bfatura\b/.test(plain),
    issuer: issuerIn(joined),
    // Sem sinal na linha, o sentido é um palpite pela descrição.
    confidence: "media",
  });
};

/** Em ordem. Proventos antes do extrato: CSV de proventos nunca vira lançamento. */
export const SMART_RECOGNIZERS: SmartRecognizer[] = [
  recognizeOfx,
  recognizeFiscal,
  recognizeDividendRecebidos,
  recognizeB3,
  recognizeNote,
  dividendSheet(null),
  recognizeSheet,
  recognizeDividendCsv,
  recognizeCsv,
  recognizeLines,
];

/** Null: as regras não entenderam. Reconhecer sem nenhum item também não serve. */
export function recognizeSmartFile(
  contents: SmartContents,
  recognizers: SmartRecognizer[] = SMART_RECOGNIZERS,
): SmartReading | null {
  for (const recognize of recognizers) {
    const reading = recognize(contents);
    if (!reading) continue;
    // Arquivo de proventos sem linha aproveitável continua sendo de proventos: não cai no extrato.
    if (reading.proposals.length > 0 || reading.docType === "proventos") return capped(reading);
  }
  return null;
}

/** Arquivo com mais itens que isto entra pela metade, com aviso, e não derruba a revisão. */
function capped(reading: SmartReading): SmartReading {
  const total = reading.proposals.length;
  if (total <= SMART_MAX_ITEMS_PER_FILE) return reading;
  return {
    ...reading,
    proposals: reading.proposals.slice(0, SMART_MAX_ITEMS_PER_FILE),
    notes: [...reading.notes, smartNote("itens_cortados", total)],
  };
}
