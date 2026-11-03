// Importador inteligente (ADR-0030): o que é um lote, como conferir um arquivo e como uma proposta vira dado
// validado. Puro. Conteúdo de arquivo e resposta do modelo são dados não confiáveis: nada aqui interpreta
// instrução, e nenhum valor passa sem ser conferido. O que sai daqui é rascunho até a família aprovar.
import type { CategorySource } from "./categorize";
import type { DividendDoubt, DividendState } from "./dividend-import";
import { checkDebtFile, safeFileName, type Confidence } from "./debt-file";
import { fitsAmount } from "./fx";
import { cleanFileText } from "./investment-file";
import { normalizeTicker } from "./market";
import { money, toDbAmount, type MoneyValue } from "./money";
import type { BillingModule } from "./plans";
import { isYearMonth } from "./cashflow";
import {
  decodeStatement,
  parseStatementDate,
  withFingerprints,
  type StatementKind,
  type StatementRow,
  type StatementSource,
} from "./statement";
import { maskDocuments } from "./documents";

export const SMART_MAX_FILES = 10;
export const SMART_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const SMART_BATCH_MAX_BYTES = 40 * 1024 * 1024;
export const SMART_FAMILY_MAX_BYTES = 100 * 1024 * 1024;
/** Arquivos lidos com IA por família e por mês. Registrado em docs/specs/planos-e-assinatura.md. */
export const SMART_MODEL_FILES_PER_MONTH = 30;
/** Tokens do importador por família e por mês, além do teto diário do ADR-0018. */
export const SMART_MODEL_TOKENS_PER_MONTH = 1_500_000;
/** O que vai ao modelo por arquivo. Acima disto corta, e a tela avisa. Dá cerca de 40 mil tokens. */
export const SMART_MODEL_MAX_CHARS = 120_000;
/** Digitalização vai como está, então precisa caber: cerca de 3 mil tokens por página. */
export const SMART_MODEL_MAX_PAGES = 20;
export const SMART_MODEL_MAX_PDF_BYTES = 5 * 1024 * 1024;
/** A API recusa imagem acima de 5 MB em base64, o que dá 3,75 MB de arquivo. */
export const SMART_MODEL_MAX_IMAGE_BYTES = 3_750_000;
/** Lote que nunca teve nada aprovado é apagado depois disto. */
export const SMART_RETENTION_DAYS = 30;
/** Arquivo em leitura há mais que isto: o worker caiu. Pode ser lido de novo. */
export const SMART_STALE_MS = 5 * 60_000;
/** Lote parado na fila há mais que isto: o aviso se perdeu, e a tela pede de novo. */
export const SMART_REQUEUE_MS = 2 * 60_000;
export const SMART_MAX_ITEMS_PER_FILE = 5_000;
/** Itens em aberto por família, somando todos os lotes. O banco é quem conta. */
export const SMART_MAX_OPEN_ITEMS = 60_000;
/** Itens por página da revisão. O que não apareceu na tela não é aprovado sem confirmação. */
export const SMART_REVIEW_PAGE_SIZE = 100;
/** Quanto esperar por um arquivo em leitura ou por outro lote da mesma família, em segundos. */
export const SMART_WAIT_SECONDS = 60;
/** Abrir e reconhecer um arquivo roda em processo isolado, com estes tetos (ADR-0030). */
export const SMART_READ_TIMEOUT_MS = 30_000;
export const SMART_READ_MAX_OLD_MB = 256;
export const SMART_READ_MAX_RSS_MB = 640;
/** Na segunda queda o arquivo fica como falho: quem derruba a leitura não volta para a fila. */
export const SMART_READ_MAX_ATTEMPTS = 2;
/** A comparação do lote também roda isolada, com mais folga: lê tudo o que a família tem no período. */
export const SMART_PLAN_TIMEOUT_MS = 60_000;
export const SMART_PLAN_MAX_OLD_MB = 1_024;
export const SMART_PLAN_MAX_RSS_MB = 1_536;
/** Bytes inflados de verdade, contados ao abrir, sem confiar no que o arquivo declara. */
export const SMART_ZIP_MAX_INFLATED = 64 * 1024 * 1024;
export const SMART_PDF_MAX_INFLATED = 128 * 1024 * 1024;
/** Lote aprovado em pedaços: cada um na própria transação, sob a trava da família. */
export const SMART_APPROVAL_CHUNK = 200;
export const SMART_MAX_FIELDS = 12;
export const SMART_MAX_NOTES = 8;
const MAX_EXCERPT = 300;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 120;
const MAX_INSTALLMENTS = 480;
const MAX_MONTHLY_RATE = 100;

export const SMART_ACCEPT = ".pdf,.xml,.xlsx,.csv,.ofx,.txt,.png,.jpg,.jpeg";

export const SMART_DESTINATIONS = [
  "lancamento",
  "compra_cartao",
  "operacao",
  "provento",
  "divida",
  "consorcio",
  "renda",
  "previsao",
  "meta",
  "documento",
] as const;
export type SmartDestination = (typeof SMART_DESTINATIONS)[number];

export const SMART_DOC_TYPES = [
  "extrato",
  "fatura",
  "nota_fiscal",
  "contrato_emprestimo",
  "consorcio",
  "financiamento",
  "holerite",
  "informe_rendimentos",
  "nota_corretagem",
  "negociacao_b3",
  "proventos",
  "apolice",
  "boleto",
  "outro",
] as const;
export type SmartDocType = (typeof SMART_DOC_TYPES)[number];

export const SMART_DUPLICATE_STATES = ["novo", "possivel", "ja_lancado"] as const;
export type SmartDuplicateState = (typeof SMART_DUPLICATE_STATES)[number];

export const SMART_DIVIDEND_KINDS = ["dividendo", "jcp", "rendimento"] as const;
export const SMART_INCOME_KINDS = [
  "clt",
  "pj_autonomo",
  "aposentadoria_pensao",
  "aluguel",
  "outro",
] as const;
export const SMART_GOAL_KINDS = [
  "veiculo",
  "imovel",
  "reforma",
  "educacao",
  "compra",
  "evento",
  "outro",
] as const;

/** Módulo que libera gravar cada destino. Null: Base. Item de módulo desligado aparece e não grava. */
export const SMART_DESTINATION_MODULE: Record<SmartDestination, BillingModule | null> = {
  lancamento: null,
  compra_cartao: null,
  operacao: "investimentos",
  provento: "investimentos",
  divida: "dividas",
  consorcio: "dividas",
  renda: null,
  previsao: null,
  meta: "metas",
  documento: null,
};

export interface SmartField {
  label: string;
  value: string;
}

export interface CategoryChoice {
  categoryId: string | null;
  newCategory: { name: string; essential: boolean } | null;
  categorySource: CategorySource | null;
}

const NO_CATEGORY: CategoryChoice = { categoryId: null, newCategory: null, categorySource: null };

export interface EntryPayload extends CategoryChoice {
  destination: "lancamento";
  date: string | null;
  description: string | null;
  amount: string | null;
  kind: StatementKind;
  /** A mesma identidade do importador de extrato: arquivo já importado lá não entra de novo. */
  fingerprint: string | null;
  source: StatementSource;
  accountId: string | null;
  /** Previsão que esta linha dá baixa, como no importador de extrato. */
  matchKey: string | null;
  matchMonth: string | null;
  /** Esta linha paga a fatura deste arquivo do lote: vira baixa, e não despesa. */
  settlesFileId?: string | null;
  /** Lançamento já gravado que era o pagamento da fatura: ele vira a baixa. */
  settlesTransactionId?: string | null;
}

export interface PurchasePayload extends CategoryChoice {
  destination: "compra_cartao";
  date: string | null;
  description: string | null;
  amount: string | null;
  installments: number;
  fingerprint: string | null;
  cardId: string | null;
}

export interface TradePayload {
  destination: "operacao";
  /** Linha no arquivo: identifica a operação na conferência da gravação. */
  line: number;
  ticker: string | null;
  title: string | null;
  side: "compra" | "venda" | null;
  date: string | null;
  quantity: string | null;
  unitPrice: string | null;
  fees: string;
  doubt: "nota_nao_fecha" | null;
  accountId: string | null;
}

export interface DividendPayload {
  destination: "provento";
  /** Linha no arquivo, como em `ParsedDividend`: o plano e a gravação falam por ela. */
  line: number;
  ticker: string | null;
  kind: (typeof SMART_DIVIDEND_KINDS)[number];
  date: string | null;
  gross: string | null;
  withheld: string | null;
  net: string | null;
  ambiguous?: true;
  /** O que a pessoa viu na revisão: mudou até a gravação, a linha é pulada (ADR-0029). */
  planState?: DividendState | null;
  planDoubt?: DividendDoubt | null;
}

export interface DebtPayload {
  destination: "divida" | "consorcio";
  name: string | null;
  system: "price" | "sac" | "manual" | null;
  balance: string | null;
  monthlyRate: string | null;
  installments: number | null;
  installmentAmount: string | null;
  firstDueDate: string | null;
  accountId: string | null;
}

export interface IncomePayload extends CategoryChoice {
  destination: "renda";
  name: string | null;
  kind: (typeof SMART_INCOME_KINDS)[number];
  amount: string | null;
  isGross: boolean;
  payDay: number | null;
  startMonth: string | null;
  accountId: string | null;
}

export interface ForecastPayload extends CategoryChoice {
  destination: "previsao";
  description: string | null;
  amount: string | null;
  kind: StatementKind;
  day: number | null;
  startMonth: string | null;
  endMonth: string | null;
  accountId: string | null;
}

export interface GoalPayload {
  destination: "meta";
  name: string | null;
  kind: (typeof SMART_GOAL_KINDS)[number];
  targetAmount: string | null;
  desiredMonth: string | null;
}

export interface DocumentPayload {
  destination: "documento";
  title: string | null;
}

export type SmartPayload =
  | EntryPayload
  | PurchasePayload
  | TradePayload
  | DividendPayload
  | DebtPayload
  | IncomePayload
  | ForecastPayload
  | GoalPayload
  | DocumentPayload;

/** Uma proposta antes de comparar com o que existe. */
export interface SmartProposal {
  payload: SmartPayload;
  confidence: Confidence;
  excerpt: string | null;
}

/** O que um arquivo é e tudo o que saiu dele, venha das regras ou do modelo. */
export interface SmartReading {
  docType: SmartDocType;
  issuer: string | null;
  confidence: Confidence;
  proposals: SmartProposal[];
  fields: SmartField[];
  /** `codigo:<nome>` ou `codigo:<nome>:<n>` têm texto na tela; o resto é frase curta do modelo. */
  notes: string[];
}

export const smartNote = (code: string, count?: number) =>
  count === undefined ? `codigo:${code}` : `codigo:${code}:${count}`;

export const SMART_FILE_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  csv: "text/csv",
  txt: "text/plain",
  xml: "application/xml",
  ofx: "application/x-ofx",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
export type SmartFileKind = keyof typeof SMART_FILE_TYPES;

export const smartKindOf = (mediaType: string): SmartFileKind | null =>
  (Object.entries(SMART_FILE_TYPES).find(([, type]) => type === mediaType)?.[0] as
    SmartFileKind | undefined) ?? null;

export type SmartFileCheck =
  | { ok: true; kind: SmartFileKind; mediaType: string; fileName: string }
  | { ok: false; code: "vazio" | "tamanho" | "tipo" | "xml_inseguro" };

const CONTROL = /(?![\t\r\n])\p{Cc}/u;

/**
 * XML nunca é aberto por biblioteca que resolva entidades: o reconhecimento lê marcas com expressão regular.
 * Mesmo assim, DOCTYPE é recusado na porta, porque NF-e, CF-e e OFX não precisam dele e é por ali que entra
 * entidade externa ou expansão em cadeia.
 */
export const hasXmlDeclarations = (text: string) => /<!\s*(doctype|entity)/i.test(text);

function checkText(bytes: Uint8Array, kind: "txt" | "xml" | "ofx"): SmartFileCheck["ok"] | "xml" {
  if (bytes.includes(0)) return false;
  const text = decodeStatement(bytes);
  if (CONTROL.test(text)) return false;
  const start = text.trimStart();
  if (start.startsWith("%PDF") || /^<!doctype html|^<html/i.test(start)) return false;
  if (kind === "txt") return true;
  if (hasXmlDeclarations(text)) return "xml";
  if (kind === "ofx") return /<OFX[\s>]/i.test(text);
  return start.startsWith("<");
}

/** Tipo pelo conteúdo, a extensão concorda com ele, e zip bomb e XXE param aqui. */
export function checkSmartFile(bytes: Uint8Array, name: string): SmartFileCheck {
  if (bytes.length === 0) return { ok: false, code: "vazio" };
  if (bytes.length > SMART_FILE_MAX_BYTES) return { ok: false, code: "tamanho" };
  const fileName = safeFileName(name);
  const extension = fileName.split(".").at(-1)?.toLowerCase() ?? "";
  if (extension === "txt" || extension === "xml" || extension === "ofx") {
    const verdict = checkText(bytes, extension);
    if (verdict === "xml") return { ok: false, code: "xml_inseguro" };
    if (!verdict) return { ok: false, code: "tipo" };
    return { ok: true, kind: extension, mediaType: SMART_FILE_TYPES[extension], fileName };
  }
  const debt = checkDebtFile(bytes, name);
  if (!debt.ok) return { ok: false, code: debt.code };
  return { ok: true, kind: debt.kind, mediaType: debt.mediaType, fileName: debt.fileName };
}

/** Texto com jeito de ordem, link ou marca não vira dado. Vale para o modelo e para o que vem do arquivo. */
const UNSAFE_TEXT =
  /https?:|www\.|[<>]|\b(ignore|ignorar|ignora|instruç|instruction|instruccion|system prompt|prompt)\b/i;

/** Texto curto que pode entrar no cadastro. Sem CPF, sem fórmula, sem link e sem ordem. */
export function safeText(raw: unknown, max: number): string | null {
  const text = maskDocuments(cleanFileText(raw, max * 2), "[documento]")
    .slice(0, max)
    .trim();
  return text && !UNSAFE_TEXT.test(text) ? text : null;
}

export const safeExcerpt = (raw: unknown): string | null => {
  const text = cleanFileText(raw, MAX_EXCERPT * 2);
  if (!text) return null;
  // Trecho é para a pessoa conferir: fica o texto, sem marca, e a tela mostra como texto puro.
  return maskDocuments(text, "[documento]").replace(/[<>]/g, " ").slice(0, MAX_EXCERPT).trim();
};

const MIN_YEAR = 1990;
const MAX_YEARS_AHEAD = 40;
/** Lançamento, compra, operação e provento já aconteceram, ou estão para acontecer. */
const MAX_ENTRY_YEARS_BACK = 15;
const MAX_ENTRY_DAYS_AHEAD = 45;
const MAX_NUMBER_TEXT = 40;
const STRICT_NUMBER = /^\d+(\.\d+)?$/;
const STRICT_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STRICT_INTEGER = /^\d{1,6}$/;

/** Só `123` ou `123.45`. Vírgula, milhar, sinal, expoente e infinito não são número aqui. */
function strictNumber(raw: unknown): MoneyValue | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text.length > MAX_NUMBER_TEXT || !STRICT_NUMBER.test(text)) return null;
  return money(text);
}

function dateField(raw: unknown, today: string): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!STRICT_DATE.test(text)) return null;
  const date = parseStatementDate(text);
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return year >= MIN_YEAR && year <= Number(today.slice(0, 4)) + MAX_YEARS_AHEAD ? date : null;
}

/** Data que não cabe num movimento: vai para a pessoa conferir, sem entrar sozinha. */
export function plausibleEntryDate(date: string, today: string): boolean {
  const day = (text: string) => Date.parse(`${text}T00:00:00Z`) / 86_400_000;
  const distance = day(date) - day(today);
  return distance <= MAX_ENTRY_DAYS_AHEAD && distance >= -MAX_ENTRY_YEARS_BACK * 365;
}

const amountField = (raw: unknown): string | null => {
  const value = strictNumber(raw);
  if (!value || value.isZero() || !fitsAmount(value.toFixed(2))) return null;
  const db = toDbAmount(value);
  return money(db).isZero() ? null : db;
};

const zeroOr = (raw: unknown) => amountField(raw) ?? "0.00";

const intField = (raw: unknown, min: number, max: number): number | null => {
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!STRICT_INTEGER.test(text)) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
};

const monthField = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const text = raw.trim().slice(0, 7);
  return /^\d{4}-\d{2}$/.test(text) && isYearMonth(text) ? text : null;
};

/** Quantidade e preço: até 8 casas, sem arredondar o que a pessoa ou o arquivo disse. */
const decimalField = (raw: unknown): string | null => {
  const value = strictNumber(raw);
  if (!value || value.lte(0) || value.gte("1000000000000")) return null;
  return value.toDecimalPlaces(8).toFixed();
};

const rateField = (raw: unknown): string | null => {
  const value = strictNumber(raw);
  if (!value || value.gt(MAX_MONTHLY_RATE)) return null;
  return value.toFixed(4);
};

const oneOf = <T extends string>(raw: unknown, options: readonly T[], fallback: T): T =>
  options.includes(raw as T) ? (raw as T) : fallback;

/** Campos soltos, como vêm do modelo ou da tela: sempre texto. */
export type SmartRawFields = Partial<
  Record<
    | "description"
    | "date"
    | "amount"
    | "kind"
    | "installments"
    | "installmentAmount"
    | "rate"
    | "system"
    | "day"
    | "startMonth"
    | "endMonth"
    | "ticker"
    | "quantity"
    | "unitPrice"
    | "fees"
    | "side"
    | "subtype"
    | "withheld"
    | "isGross",
    string
  >
>;

const kindOf = (raw: unknown): StatementKind => (raw === "receita" ? "receita" : "despesa");

/** Constrói o rascunho de um destino. Valor que não confere vira vazio: quem decide é a revisão. */
export function buildSmartPayload(
  destination: SmartDestination,
  raw: SmartRawFields,
  today: string,
): SmartPayload {
  const description = safeText(raw.description, MAX_DESCRIPTION);
  const name = safeText(raw.description, MAX_NAME);
  const date = dateField(raw.date, today);
  const amount = amountField(raw.amount);
  switch (destination) {
    case "lancamento":
      return {
        destination,
        date,
        description,
        amount,
        kind: kindOf(raw.kind),
        fingerprint: null,
        source: "csv",
        accountId: null,
        matchKey: null,
        matchMonth: null,
        ...NO_CATEGORY,
      };
    case "compra_cartao":
      return {
        destination,
        date,
        description,
        amount,
        installments: intField(raw.installments, 1, 120) ?? 1,
        fingerprint: null,
        cardId: null,
        ...NO_CATEGORY,
      };
    case "operacao":
      return {
        destination,
        line: 0,
        ticker: normalizeTicker(raw.ticker),
        title: safeText(raw.description, MAX_NAME),
        side: raw.side === "compra" || raw.side === "venda" ? raw.side : null,
        date,
        quantity: decimalField(raw.quantity),
        unitPrice: decimalField(raw.unitPrice),
        fees: zeroOr(raw.fees),
        doubt: null,
        accountId: null,
      };
    case "provento":
      return {
        destination,
        line: 0,
        ticker: normalizeTicker(raw.ticker),
        kind: oneOf(raw.subtype, SMART_DIVIDEND_KINDS, "rendimento"),
        date,
        gross: amount,
        withheld: amountField(raw.withheld),
        net: null,
      };
    case "divida":
    case "consorcio": {
      const installmentAmount = amountField(raw.installmentAmount);
      const system =
        destination === "consorcio"
          ? "manual"
          : raw.system === "price" || raw.system === "sac" || raw.system === "manual"
            ? raw.system
            : null;
      return {
        destination,
        name,
        system,
        balance: amount,
        monthlyRate: destination === "consorcio" ? "0.0000" : rateField(raw.rate),
        installments: intField(raw.installments, 1, MAX_INSTALLMENTS),
        installmentAmount,
        firstDueDate: date,
        accountId: null,
      };
    }
    case "renda":
      return {
        destination,
        name,
        kind: oneOf(raw.subtype, SMART_INCOME_KINDS, "outro"),
        amount,
        isGross: raw.isGross === "sim",
        payDay: intField(raw.day, 1, 31),
        startMonth: monthField(raw.startMonth) ?? today.slice(0, 7),
        accountId: null,
        ...NO_CATEGORY,
      };
    case "previsao":
      return {
        destination,
        description,
        amount,
        kind: kindOf(raw.kind),
        day: intField(raw.day, 1, 31) ?? (date ? Number(date.slice(8, 10)) : null),
        startMonth: monthField(raw.startMonth) ?? date?.slice(0, 7) ?? today.slice(0, 7),
        endMonth: monthField(raw.endMonth),
        accountId: null,
        ...NO_CATEGORY,
      };
    case "meta":
      return {
        destination,
        name,
        kind: oneOf(raw.subtype, SMART_GOAL_KINDS, "outro"),
        targetAmount: amount,
        desiredMonth: monthField(raw.startMonth),
      };
    case "documento":
      return { destination, title: name };
  }
}

/** O rascunho de volta aos campos soltos: o que a edição não mandou fica como está. */
function rawOfPayload(payload: SmartPayload): SmartRawFields {
  switch (payload.destination) {
    case "lancamento":
      return {
        description: payload.description ?? "",
        date: payload.date ?? "",
        amount: payload.amount ?? "",
        kind: payload.kind,
      };
    case "compra_cartao":
      return {
        description: payload.description ?? "",
        date: payload.date ?? "",
        amount: payload.amount ?? "",
        installments: String(payload.installments),
      };
    case "operacao":
      return {
        description: payload.title ?? "",
        ticker: payload.ticker ?? "",
        side: payload.side ?? "",
        date: payload.date ?? "",
        quantity: payload.quantity ?? "",
        unitPrice: payload.unitPrice ?? "",
        fees: payload.fees,
      };
    case "provento":
      return {
        ticker: payload.ticker ?? "",
        subtype: payload.kind,
        date: payload.date ?? "",
        amount: payload.gross ?? "",
        withheld: payload.withheld ?? "",
      };
    case "divida":
    case "consorcio":
      return {
        description: payload.name ?? "",
        system: payload.system ?? "",
        amount: payload.balance ?? "",
        rate: payload.monthlyRate ?? "",
        installments: payload.installments === null ? "" : String(payload.installments),
        installmentAmount: payload.installmentAmount ?? "",
        date: payload.firstDueDate ?? "",
      };
    case "renda":
      return {
        description: payload.name ?? "",
        subtype: payload.kind,
        amount: payload.amount ?? "",
        isGross: payload.isGross ? "sim" : "nao",
        day: payload.payDay === null ? "" : String(payload.payDay),
        startMonth: payload.startMonth ?? "",
      };
    case "previsao":
      return {
        description: payload.description ?? "",
        amount: payload.amount ?? "",
        kind: payload.kind,
        day: payload.day === null ? "" : String(payload.day),
        startMonth: payload.startMonth ?? "",
        endMonth: payload.endMonth ?? "",
      };
    case "meta":
      return {
        description: payload.name ?? "",
        subtype: payload.kind,
        amount: payload.targetAmount ?? "",
        startMonth: payload.desiredMonth ?? "",
      };
    case "documento":
      return { description: payload.title ?? "" };
  }
}

/** A baixa de fatura sai de propósito: editar a linha é dizer que ela não é o que parecia. */
const KEPT_ON_EDIT = [
  "fingerprint",
  "source",
  "accountId",
  "cardId",
  "matchKey",
  "matchMonth",
  "categoryId",
  "newCategory",
  "categorySource",
  "line",
  "doubt",
  "net",
  "ambiguous",
  "planState",
  "planDoubt",
] as const;

/** Só muda o que veio em `raw`. Identidade, conta, categoria e baixa ficam com o item. */
export function mergeSmartEdit(
  current: SmartPayload,
  raw: SmartRawFields,
  today: string,
): SmartPayload {
  const edited = buildSmartPayload(
    current.destination,
    { ...rawOfPayload(current), ...raw },
    today,
  );
  const keep = Object.fromEntries(
    KEPT_ON_EDIT.flatMap((key) =>
      key in current ? [[key, (current as unknown as Record<string, unknown>)[key]]] : [],
    ),
  );
  const merged = { ...edited, ...keep } as SmartPayload;
  // Bruto novo: o líquido do arquivo deixa de valer, e o plano refaz a conta.
  if (merged.destination === "provento" && edited.destination === "provento") {
    const before = current.destination === "provento" ? current.gross : null;
    if (edited.gross !== before) merged.net = null;
  }
  return merged;
}

/** O que falta para gravar. `account` e `card` já somam o que o arquivo escolheu. */
export function missingSmartFields(
  payload: SmartPayload,
  file: { accountId: string | null; cardId: string | null } = { accountId: null, cardId: null },
): string[] {
  const missing: string[] = [];
  // Baixa de fatura não cria lançamento com categoria própria: conta e categoria vêm da fatura.
  if (payload.destination === "lancamento" && payload.settlesFileId) return [];
  const need = (field: string, value: unknown) => {
    if (value === null || value === undefined || value === "") missing.push(field);
  };
  const category = (choice: CategoryChoice) => {
    if (!choice.categoryId && !choice.newCategory) missing.push("category");
  };
  switch (payload.destination) {
    case "lancamento":
      need("date", payload.date);
      need("description", payload.description);
      need("amount", payload.amount);
      need("account", payload.accountId ?? file.accountId);
      category(payload);
      break;
    case "compra_cartao":
      need("date", payload.date);
      need("description", payload.description);
      need("amount", payload.amount);
      need("card", payload.cardId ?? file.cardId);
      category(payload);
      break;
    case "operacao":
      need("ticker", payload.ticker);
      need("side", payload.side);
      need("date", payload.date);
      need("quantity", payload.quantity);
      need("unitPrice", payload.unitPrice);
      break;
    case "provento":
      need("ticker", payload.ticker);
      need("date", payload.date);
      need("amount", payload.gross ?? payload.net);
      break;
    case "divida":
    case "consorcio":
      need("name", payload.name);
      need("account", payload.accountId ?? file.accountId);
      need("system", payload.system);
      need("installments", payload.installments);
      need("firstDueDate", payload.firstDueDate);
      if (payload.system === "manual") need("installmentAmount", payload.installmentAmount);
      else {
        need("amount", payload.balance);
        need("rate", payload.monthlyRate);
      }
      break;
    case "renda":
      need("name", payload.name);
      need("amount", payload.amount);
      need("day", payload.payDay);
      need("account", payload.accountId ?? file.accountId);
      category(payload);
      break;
    case "previsao":
      need("description", payload.description);
      need("amount", payload.amount);
      need("day", payload.day);
      need("account", payload.accountId ?? file.accountId);
      category(payload);
      break;
    case "meta":
      need("name", payload.name);
      need("amount", payload.targetAmount);
      break;
    case "documento":
      break;
  }
  return missing;
}

/** Valor do item na tela e nos totais, e para que lado vai. Null: não é dinheiro entrando ou saindo. */
export function smartFlow(payload: SmartPayload): { amount: string; in: boolean } | null {
  switch (payload.destination) {
    case "lancamento":
      return payload.amount ? { amount: payload.amount, in: payload.kind === "receita" } : null;
    case "compra_cartao":
      return payload.amount ? { amount: payload.amount, in: false } : null;
    case "provento": {
      const amount = payload.gross ?? payload.net;
      return amount ? { amount, in: true } : null;
    }
    case "operacao": {
      if (!payload.quantity || !payload.unitPrice) return null;
      const gross = toDbAmount(money(payload.quantity).times(payload.unitPrice));
      return { amount: gross, in: payload.side === "venda" };
    }
    default:
      return null;
  }
}

/**
 * Soma dos itens contra o total que o próprio documento diz. Diferença não bloqueia: o arquivo fica com
 * confiança baixa e a tela avisa. Só compara o que soma: lançamentos e compras de um lado só.
 */
export function totalsClose(proposals: SmartProposal[], declared: string | null): boolean {
  if (!declared) return true;
  const flows = proposals.flatMap((proposal) => {
    const flow = smartFlow(proposal.payload);
    return flow && proposal.payload.destination !== "operacao" ? [flow] : [];
  });
  if (flows.length === 0) return true;
  const total = flows.reduce((acc, flow) => acc.plus(flow.amount), money(0));
  return total.minus(declared).abs().lte("0.01");
}

/**
 * Parcela vezes quantidade precisa cobrir o saldo: senão, um dos dois saiu errado. Consórcio não entra: o valor
 * é o crédito, e as parcelas são só as que faltam, então é normal não cobrir.
 */
export function debtTermsClose(payload: DebtPayload): boolean {
  const { balance, installmentAmount, installments } = payload;
  if (payload.destination === "consorcio") return true;
  if (!balance || !installmentAmount || !installments) return true;
  return money(installmentAmount).times(installments).gte(money(balance).times("0.99"));
}

export const parseDeclaredTotal = amountField;

/** Lançamento e compra lidos pelo modelo ganham a identidade do extrato: reler não duplica. */
export function withSmartFingerprints(proposals: SmartProposal[]): SmartProposal[] {
  const rows: Array<{ index: number; row: StatementRow }> = [];
  proposals.forEach(({ payload }, index) => {
    if (payload.destination !== "lancamento" && payload.destination !== "compra_cartao") return;
    const { date, amount, description } = payload;
    if (!date || !amount || !description || payload.fingerprint) return;
    const kind = payload.destination === "lancamento" ? payload.kind : "despesa";
    rows.push({ index, row: { date, amount, description, kind } });
  });
  const prints = withFingerprints(
    rows.map(({ row }) => row),
    "csv",
  );
  const out = [...proposals];
  rows.forEach(({ index }, at) => {
    out[index] = {
      ...out[index]!,
      payload: { ...out[index]!.payload, fingerprint: prints[at]!.fingerprint } as SmartPayload,
    };
  });
  return out;
}

/**
 * O que pode ir aos agentes e à tela como campo do documento. Lista do que é permitido, e não do que é proibido:
 * rótulo novo fica de fora até alguém decidir, porque um nome de pessoa pode vir com qualquer título.
 */
const ALLOWED_FIELD =
  /^(numero|n|no|nro|codigo)?\s*(do|da|de)?\s*(contrato|apolice|proposta|grupo|cota|plano|produto|modalidade|ramo)\b|^(valor|total|premio|credito|saldo|parcela|parcelas|prazo|vigencia|vencimento|inicio|fim|taxa|juros|cet|custo efetivo|competencia|periodo|ano|mes|franquia|cobertura|indice|correcao|produto \d+)/;

export function smartFieldAllowed(label: string): boolean {
  const plain = label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim();
  return ALLOWED_FIELD.test(plain);
}

/** Conta ou cartão com o nome do emissor, ou a única que existe. O resto a pessoa escolhe na revisão. */
export function suggestByIssuer<T extends { id: string; name: string }>(
  issuer: string | null,
  options: T[],
): string | null {
  if (options.length === 1) return options[0]!.id;
  const words = (text: string) =>
    text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && word !== "banco" && word !== "conta");
  const wanted = new Set(words(issuer ?? ""));
  const found = options.filter((option) => words(option.name).some((word) => wanted.has(word)));
  return found.length === 1 ? found[0]!.id : null;
}
