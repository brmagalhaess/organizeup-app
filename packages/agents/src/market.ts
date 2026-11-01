// Clientes da brapi e do SGS do Banco Central (ADR-0017). Sem banco e sem dado de família: só recebem
// um ticker válido. Toda chamada roda fora de withHousehold (regra do tenant.ts). Formatos conferidos
// contra as APIs reais em 2026-10-31. O erro leva só um código: nem o endereço nem a resposta, e o
// token vai no cabeçalho, como pede a documentação, para não parar em log de ninguém.
import {
  marketDateOf,
  MARKET_RULES,
  money,
  normalizeTicker,
  paidRate,
  shiftYears,
  type DividendKind,
  type FxCurrency,
  type StockEvent,
} from "@organizeup/domain";
import type {
  MarketAssetRow,
  MarketDividendRow,
  MarketFxRow,
  MarketIndexCode,
} from "@organizeup/db";
import { z } from "zod";

export const BRAPI_URL = "https://brapi.dev";
export const SGS_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs";
export const BRAPI_SOURCE = "brapi.dev";
/** Respondem sem token (documentação da brapi, "Teste sem chave"). */
export const KEYLESS_TICKERS: readonly string[] = ["PETR4", "VALE3", "MGLU3", "ITUB4"];
export const FETCH_TIMEOUT_MS = 15_000;

/** Séries do SGS: CDI e SELIC em % ao dia, IPCA em % ao mês. */
export const SGS_SERIES: Record<MarketIndexCode, number> = { CDI: 12, SELIC: 11, IPCA: 433 };
/**
 * PTAX de venda em reais por unidade, conferida contra o boletim de fechamento da PTAX (ADR-0020).
 * A 21619 chega com 7 casas, e a série 1 com 4.
 */
export const FX_SERIES: Record<FxCurrency, number> = { USD: 1, EUR: 21619 };
export const FX_SOURCE = "bcb.sgs";
/** Máximo de pontos pedidos a cada série: basta para cobrir semanas sem rodar. */
const SGS_LAST_POINTS = 20;

export type MarketErrorCode =
  | "nao_encontrado"
  | "sem_token"
  | "token_invalido"
  | "plano"
  | "limite"
  | "servidor"
  | "rede"
  | "formato";

export class MarketError extends Error {
  readonly code: MarketErrorCode;
  constructor(code: MarketErrorCode) {
    super(`mercado: ${code}`);
    this.name = "MarketError";
    this.code = code;
  }
}

export interface MarketClientOptions {
  token?: string | undefined;
  /** Hoje na B3; define até onde vai o histórico coletado. */
  today: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function codeOfStatus(status: number, body: unknown): MarketErrorCode {
  if (status === 400 || status === 404) return "nao_encontrado";
  if (status === 401) {
    const code = (body as { code?: unknown } | null)?.code;
    return code === "MISSING_TOKEN" ? "sem_token" : "token_invalido";
  }
  if (status === 403) return "plano";
  if (status === 429) return "limite";
  return "servidor";
}

async function getJson(url: string, options: MarketClientOptions): Promise<unknown> {
  const run = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await run(url, {
      headers: {
        accept: "application/json",
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new MarketError("rede");
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (response.ok) throw new MarketError("formato");
  }
  if (!response.ok) throw new MarketError(codeOfStatus(response.status, body));
  return body;
}

// A brapi manda número em JSON. Passa a texto na borda para não fazer conta com `number` (regra 4).
const decimal = z.number().transform((value) => String(value));
const moment = z.iso.datetime({ offset: true });

const cashDividend = z.object({
  rate: decimal,
  rawRate: decimal.nullish(),
  label: z.string(),
  lastDatePrior: moment.nullish(),
  exDate: moment.nullish(),
  paymentDate: moment.nullish(),
  verified: z.boolean().nullish(),
  remarks: z.string().nullish(),
});
type CashDividend = z.infer<typeof cashDividend>;

const stockDividend = z.object({
  factor: decimal,
  completeFactor: z.string().nullish(),
  label: z.string(),
  lastDatePrior: moment.nullish(),
});
type StockDividend = z.infer<typeof stockDividend>;

/** Só eventos que mudam a quantidade de ações e o preço. Cisão e afins ficam de fora. */
const STOCK_EVENT_LABELS: Record<string, string> = {
  DESDOBRAMENTO: "Desdobramento",
  GRUPAMENTO: "Grupamento",
  BONIFICACAO: "Bonificação",
};

const quoteResult = z.object({
  symbol: z.string(),
  regularMarketPrice: z.number().positive(),
  regularMarketChangePercent: z.number().nullish(),
  regularMarketTime: moment,
  dividendsData: z
    .object({
      cashDividends: z.array(z.unknown()).nullish(),
      stockDividends: z.array(z.unknown()).nullish(),
    })
    .nullish(),
});

const quoteResponse = z.object({ results: z.array(z.unknown()).min(1) });
const fiiResponse = z.object({ dividends: z.array(z.unknown()) });
const sgsResponse = z.array(z.object({ data: z.string(), valor: z.string() }));

const LABEL_KINDS: Record<string, DividendKind> = {
  DIVIDENDO: "dividendo",
  JCP: "jcp",
  RENDIMENTO: "rendimento",
};

const parseEach = <T>(schema: z.ZodType<T>, rows: unknown[] | null | undefined): T[] =>
  (rows ?? []).flatMap((row) => {
    const parsed = schema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });

function stockEventsOf(rows: StockDividend[]): Array<StockEvent & { note: string }> {
  return rows.flatMap((row) => {
    const label = STOCK_EVENT_LABELS[row.label];
    if (!label || !row.lastDatePrior) return [];
    const note = row.completeFactor ? `${label} de ${row.completeFactor}` : label;
    return [
      { comDate: marketDateOf(row.lastDatePrior), factor: row.factor, note: note.slice(0, 120) },
    ];
  });
}

/** Eventos como a tabela guarda: 8 casas, sem o que arredondaria para zero (a fonte não confirma). */
const storableStockEvents = (events: Array<StockEvent & { note: string }>) =>
  events.flatMap((event) => {
    const factor = money(event.factor).toFixed(8);
    return money(factor).gt(0) ? [{ ...event, factor }] : [];
  });

/**
 * Filtra o que dá para usar. Fica de fora o que a fonte não confirma: `verified` falso (em ações,
 * sobra só correção de provento), sem data de pagamento e rótulo fora dos três tipos, como
 * amortização, que devolve capital. Pagamentos iguais com valores diferentes ganham `seq`.
 */
function dividendRows(
  ticker: string,
  rows: CashDividend[],
  today: string,
  rateOf: (row: CashDividend, comDate: string) => string,
): MarketDividendRow[] {
  const since = shiftYears(today, -MARKET_RULES.historyYears);
  const usable = rows.flatMap((row) => {
    const kind = LABEL_KINDS[row.label];
    if (!kind || row.verified !== true || !row.lastDatePrior || !row.paymentDate) return [];
    const comDate = marketDateOf(row.lastDatePrior);
    if (comDate < since) return [];
    const ratePerShare = rateOf(row, comDate);
    if (money(ratePerShare).lte(0)) return [];
    return [
      {
        ticker,
        kind,
        comDate,
        exDate: row.exDate ? marketDateOf(row.exDate) : null,
        payDate: marketDateOf(row.paymentDate),
        ratePerShare,
        seq: 1,
        source: BRAPI_SOURCE,
      },
    ];
  });
  usable.sort((a, b) => money(b.ratePerShare).comparedTo(a.ratePerShare));
  const seen = new Map<string, number>();
  return usable.map((row) => {
    const key = `${row.kind}|${row.comDate}|${row.payDate}`;
    const seq = (seen.get(key) ?? 0) + 1;
    seen.set(key, seq);
    return { ...row, seq };
  });
}

const catalogResponse = z.object({
  stocks: z.array(z.unknown()),
  hasNextPage: z.boolean().nullish(),
});
const catalogRow = z.object({
  stock: z.string(),
  name: z.string().nullish(),
  close: z.number().positive().nullish(),
  sector: z.string().nullish(),
  type: z.string().nullish(),
  subType: z.string().nullish(),
});

/** Fundo sem renda periódica (FIP, FIDC) fica fora: o catálogo é o que o sistema sabe acompanhar. */
function catalogClass(type: string, subType: string | null | undefined) {
  if (type === "stock") return "acao" as const;
  if (type === "bdr") return "etf_bdr" as const;
  if (type !== "fund") return null;
  if (subType === "etf") return "etf_bdr" as const;
  return subType === "fii" || subType === "fi-agro" || subType === "fi-infra"
    ? ("fii" as const)
    : null;
}

const CATALOG_PAGE = 2000;
const CATALOG_MAX_PAGES = 5;

/** Lista inteira da bolsa. Rota pública, que vale para todos os ativos numa chamada por página. */
export async function fetchBrapiCatalog(options: MarketClientOptions) {
  const rows: MarketAssetRow[] = [];
  let pages = 0;
  for (let page = 1; page <= CATALOG_MAX_PAGES; page += 1) {
    const url = `${BRAPI_URL}/api/quote/list?limit=${CATALOG_PAGE}&page=${page}`;
    const parsed = catalogResponse.safeParse(await getJson(url, options));
    if (!parsed.success) throw new MarketError("formato");
    pages += 1;
    for (const row of parseEach(catalogRow, parsed.data.stocks)) {
      const ticker = normalizeTicker(row.stock);
      const assetClass = catalogClass(row.type ?? "", row.subType);
      if (ticker !== row.stock || !assetClass) continue;
      rows.push({
        ticker,
        name: (row.name?.trim() || ticker).slice(0, 160),
        assetClass,
        sector: row.sector?.trim().slice(0, 120) || null,
        close: row.close == null ? null : money(String(row.close)).toFixed(8),
      });
    }
    if (!parsed.data.hasNextPage) break;
  }
  return { rows, pages };
}

export interface BrapiQuote {
  ticker: string;
  price: string;
  changePercent: string | null;
  quotedAt: Date;
  lastStockEventOn: string | null;
  lastStockEventNote: string | null;
  /** Todos os desdobramentos, grupamentos e bonificações que a fonte traz. */
  stockEvents: Array<StockEvent & { note: string }>;
  dividends: MarketDividendRow[];
}

/**
 * Cotação e proventos de um ticker numa chamada só. A rota antiga continua ativa, sem data de remoção,
 * e a v2 pede uma chamada para cada tipo de dado, o que dobraria o gasto da cota.
 */
export async function fetchBrapiQuote(
  ticker: string,
  options: MarketClientOptions,
): Promise<BrapiQuote> {
  const url = `${BRAPI_URL}/api/quote/${encodeURIComponent(ticker)}?dividends=true`;
  const envelope = quoteResponse.safeParse(await getJson(url, options));
  if (!envelope.success) throw new MarketError("formato");
  const parsed = quoteResult.safeParse(envelope.data.results[0]);
  if (!parsed.success) throw new MarketError("formato");
  const quote = parsed.data;

  const events = stockEventsOf(parseEach(stockDividend, quote.dividendsData?.stockDividends));
  const latest = [...events].sort((a, b) => b.comDate.localeCompare(a.comDate))[0];
  const dividends = dividendRows(
    ticker,
    parseEach(cashDividend, quote.dividendsData?.cashDividends),
    options.today,
    (row, comDate) => paidRate(row.rate, comDate, events),
  );
  return {
    ticker,
    price: money(String(quote.regularMarketPrice)).toFixed(8),
    changePercent:
      quote.regularMarketChangePercent == null
        ? null
        : money(String(quote.regularMarketChangePercent)).toFixed(4),
    quotedAt: new Date(quote.regularMarketTime),
    lastStockEventOn: latest?.comDate ?? null,
    lastStockEventNote: latest?.note ?? null,
    stockEvents: storableStockEvents(events),
    dividends,
  };
}

/**
 * Rendimentos de FII, que têm rota própria e trazem `rawRate`, o valor pago na data. Quando a fonte
 * não tem as datas reais, usa a data do informe mensal e explica em `remarks`: isso fica de fora,
 * porque a data-com errada daria direito errado.
 */
export async function fetchFiiDividends(
  ticker: string,
  options: MarketClientOptions,
): Promise<MarketDividendRow[]> {
  const url = `${BRAPI_URL}/api/v2/fii/dividends?symbols=${encodeURIComponent(ticker)}`;
  const parsed = fiiResponse.safeParse(await getJson(url, options));
  if (!parsed.success) throw new MarketError("formato");
  const rows = parseEach(cashDividend, parsed.data.dividends).filter((row) => !row.remarks?.trim());
  return dividendRows(ticker, rows, options.today, (row) =>
    money(row.rawRate ?? row.rate).toFixed(8),
  );
}

/** Últimos pontos de uma série do SGS. Serviço público, sem chave. */
export async function fetchSgsSeries(
  code: MarketIndexCode,
  options: MarketClientOptions,
): Promise<Array<{ code: MarketIndexCode; date: string; value: string }>> {
  const url = `${SGS_URL}.${SGS_SERIES[code]}/dados/ultimos/${SGS_LAST_POINTS}?formato=json`;
  const parsed = sgsResponse.safeParse(await getJson(url, { ...options, token: undefined }));
  if (!parsed.success) throw new MarketError("formato");
  return parsed.data.flatMap(({ data, valor }) => {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data);
    if (!match || !/^-?\d+(\.\d+)?$/.test(valor)) return [];
    return [{ code, date: `${match[3]}-${match[2]}-${match[1]}`, value: money(valor).toFixed(8) }];
  });
}

/** O SGS recebe e devolve datas como dd/mm/aaaa. */
const sgsDate = (date: string) => date.split("-").reverse().join("/");

/**
 * PTAX de venda de um intervalo. O SGS recusa janela de mais de 10 anos (406) e responde 404 quando não há
 * valor no intervalo, como num fim de semana: isso não é erro, é lista vazia.
 */
export async function fetchFxSeries(
  currency: FxCurrency,
  from: string,
  to: string,
  options: MarketClientOptions,
): Promise<MarketFxRow[]> {
  const url =
    `${SGS_URL}.${FX_SERIES[currency]}/dados?formato=json` +
    `&dataInicial=${sgsDate(from)}&dataFinal=${sgsDate(to)}`;
  let body: unknown;
  try {
    body = await getJson(url, { ...options, token: undefined });
  } catch (error) {
    if (error instanceof MarketError && error.code === "nao_encontrado") return [];
    throw error;
  }
  const parsed = sgsResponse.safeParse(body);
  if (!parsed.success) throw new MarketError("formato");
  return parsed.data.flatMap(({ data, valor }) => {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data);
    if (!match || !/^\d+(\.\d+)?$/.test(valor) || money(valor).lte(0)) return [];
    return [
      {
        currency,
        date: `${match[3]}-${match[2]}-${match[1]}`,
        rate: money(valor).toFixed(8),
        source: FX_SOURCE,
      },
    ];
  });
}
