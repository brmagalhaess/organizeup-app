// Clientes das fontes de mercado (ADR-0017, ADR-0032, ADR-0035): Yahoo para cotação, B3 para proventos
// e eventos de ações e rendimentos de FII, SGS do Banco Central para índices e câmbio, e a rota pública
// da brapi só para o catálogo de nomes. Sem banco e sem dado de família: só recebem um ticker válido.
// Toda chamada roda fora de withHousehold (regra do tenant.ts). O erro leva só um código: nem o
// endereço nem a resposta, para não parar em log de ninguém.
import {
  MARKET_RULES,
  money,
  normalizeTicker,
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
  MarketIssuerRow,
} from "@organizeup/db";
import { z } from "zod";

/** Só o catálogo de nomes vem daqui, pela rota pública, sem chave (ADR-0035). */
export const BRAPI_URL = "https://brapi.dev";
export const SGS_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs";
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

export type MarketErrorCode = "nao_encontrado" | "limite" | "servidor" | "rede" | "formato";

export class MarketError extends Error {
  readonly code: MarketErrorCode;
  constructor(code: MarketErrorCode) {
    super(`mercado: ${code}`);
    this.name = "MarketError";
    this.code = code;
  }
}

export interface MarketClientOptions {
  /** Hoje na B3; define até onde vai o histórico coletado. */
  today: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function codeOfStatus(status: number): MarketErrorCode {
  if (status === 400 || status === 404) return "nao_encontrado";
  if (status === 429) return "limite";
  return "servidor";
}

async function getJson(
  url: string,
  options: MarketClientOptions,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const run = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await run(url, {
      headers: { accept: "application/json", ...headers },
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
  if (!response.ok) throw new MarketError(codeOfStatus(response.status));
  return body;
}

const sgsResponse = z.array(z.object({ data: z.string(), valor: z.string() }));

/** Rótulos da B3 e da brapi para os três tipos que o sistema lança. */
const LABEL_KINDS: Record<string, DividendKind> = {
  DIVIDENDO: "dividendo",
  JCP: "jcp",
  "JRS CAP PROPRIO": "jcp",
  RENDIMENTO: "rendimento",
};

const parseEach = <T>(schema: z.ZodType<T>, rows: unknown[] | null | undefined): T[] =>
  (rows ?? []).flatMap((row) => {
    const parsed = schema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });

/** Eventos como a tabela guarda: 8 casas, sem o que arredondaria para zero (a fonte não confirma). */
const storableStockEvents = (events: Array<StockEvent & { note: string }>) =>
  events.flatMap((event) => {
    const factor = money(event.factor).toFixed(8);
    return money(factor).gt(0) ? [{ ...event, factor }] : [];
  });

/**
 * Pagamentos iguais com valores diferentes ganham `seq`; linha repetida (a B3 lista a mesma classe
 * em mais de uma série de ISIN) entra uma vez só.
 */
function withSeq(rows: MarketDividendRow[]): MarketDividendRow[] {
  const unique = [
    ...new Map(
      rows.map((row) => [`${row.kind}|${row.comDate}|${row.payDate}|${row.ratePerShare}`, row]),
    ).values(),
  ];
  unique.sort((a, b) => money(b.ratePerShare).comparedTo(a.ratePerShare));
  const seen = new Map<string, number>();
  return unique.map((row) => {
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

/** Últimos pontos de uma série do SGS. Serviço público, sem chave. */
export async function fetchSgsSeries(
  code: MarketIndexCode,
  options: MarketClientOptions,
): Promise<Array<{ code: MarketIndexCode; date: string; value: string }>> {
  const url = `${SGS_URL}.${SGS_SERIES[code]}/dados/ultimos/${SGS_LAST_POINTS}?formato=json`;
  const parsed = sgsResponse.safeParse(await getJson(url, options));
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
    body = await getJson(url, options);
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

// ---------------------------------------------------------------------------------------------
// Fontes gratuitas (ADR-0032 e ADR-0035): cotação pelo Yahoo Finance; rendimentos de FII, proventos e
// eventos de ações pela própria B3. Nenhuma pede chave. São as rotas que os sites usam, então o formato
// é conferido pelo zod e qualquer mudança vira `formato`, nunca dado errado gravado.
// ---------------------------------------------------------------------------------------------

export const YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
export const YAHOO_SOURCE = "yahoo";
export const B3_FUNDS_URL = "https://sistemaswebb3-listados.b3.com.br/fundsProxy/fundsCall";
export const B3_COMPANIES_URL =
  "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall";
export const B3_SOURCE = "b3";
/** As rotas públicas recusam cliente sem identificação de navegador. */
const BROWSER_HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; OrganizeUp/1.0; +https://organizeup.crowntech.com.br)",
};

const yahooResponse = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            symbol: z.string(),
            currency: z.string().nullish(),
            regularMarketPrice: z.number().positive(),
            regularMarketTime: z.number().int().positive(),
            chartPreviousClose: z.number().positive().nullish(),
            previousClose: z.number().positive().nullish(),
          }),
        }),
      )
      .nullish(),
    error: z.object({ code: z.string().nullish() }).nullish(),
  }),
});

export interface FreeQuote {
  ticker: string;
  price: string;
  changePercent: string | null;
  quotedAt: Date;
}

/** Cotação de um ticker da B3 no Yahoo (`PETR4.SA`). Sem chave e sem cota declarada. */
export async function fetchYahooQuote(
  ticker: string,
  options: MarketClientOptions,
): Promise<FreeQuote> {
  const url = `${YAHOO_URL}/${encodeURIComponent(ticker)}.SA?range=5d&interval=1d`;
  const parsed = yahooResponse.safeParse(await getJson(url, options, BROWSER_HEADERS));
  if (!parsed.success) throw new MarketError("formato");
  const result = parsed.data.chart.result?.[0];
  if (!result) throw new MarketError("nao_encontrado");
  const { meta } = result;
  if (meta.currency && meta.currency !== "BRL") throw new MarketError("nao_encontrado");
  const previous = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const price = money(String(meta.regularMarketPrice));
  return {
    ticker,
    price: price.toFixed(8),
    changePercent:
      previous === null
        ? null
        : price.minus(String(previous)).dividedBy(String(previous)).times(100).toFixed(4),
    quotedAt: new Date(meta.regularMarketTime * 1000),
  };
}

const b3Date = z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/);
const b3Supplement = z.object({
  cashDividends: z.array(z.unknown()).nullish(),
  stockDividends: z.array(z.unknown()).nullish(),
});
const b3CashDividend = z.object({
  assetIssued: z.string().nullish(),
  label: z.string(),
  lastDatePrior: b3Date,
  paymentDate: b3Date.nullish(),
  rate: z.string(),
});
const b3StockDividend = z.object({
  assetIssued: z.string().nullish(),
  label: z.string(),
  lastDatePrior: b3Date,
  factor: z.string(),
});

const parseLoose = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** "16/11/2026" → "2026-11-16". */
const isoFromB3 = (value: string) =>
  `${value.slice(6, 10)}-${value.slice(3, 5)}-${value.slice(0, 2)}`;
/** "0,09500000000" → "0.095". */
const decimalFromB3 = (value: string) => value.replace(/\./g, "").replace(",", ".");

/** A B3 ora devolve o objeto, ora o mesmo JSON dentro de uma string: os dois valem. */
async function getB3(url: string, options: MarketClientOptions) {
  const body = await getJson(url, options, BROWSER_HEADERS);
  return typeof body === "string" ? parseLoose(body) : body;
}

/** Código de negociação → identificador na B3 (fundo ou emissora): MXRF11 → MXRF, PETR4 → PETR. */
export const b3FundIdentifier = (ticker: string) => ticker.replace(/\d+B?$/, "");

/**
 * Rendimentos de um FII direto da B3 (lista de fundos listados), com data-com, pagamento e valor por
 * cota. É a fonte oficial, então toda linha vale; amortização fica de fora como na brapi.
 */
export async function fetchB3FiiDividends(
  ticker: string,
  options: MarketClientOptions,
): Promise<MarketDividendRow[]> {
  const payload = Buffer.from(
    JSON.stringify({ cnpj: "0", identifierFund: b3FundIdentifier(ticker), typeFund: 7 }),
  ).toString("base64");
  const parsed = b3Supplement.safeParse(
    await getB3(`${B3_FUNDS_URL}/GetListedSupplementFunds/${payload}`, options),
  );
  if (!parsed.success) throw new MarketError("formato");
  const since = shiftYears(options.today, -MARKET_RULES.historyYears);
  const usable = parseEach(b3CashDividend, parsed.data.cashDividends).flatMap((row) => {
    const kind = LABEL_KINDS[row.label.trim().toUpperCase()];
    if (!kind || !row.paymentDate) return [];
    const comDate = isoFromB3(row.lastDatePrior);
    const ratePerShare = money(decimalFromB3(row.rate)).toFixed(8);
    if (comDate < since || money(ratePerShare).lte(0)) return [];
    return [
      {
        ticker,
        kind,
        comDate,
        exDate: null,
        payDate: isoFromB3(row.paymentDate),
        ratePerShare,
        seq: 1,
        source: B3_SOURCE,
      },
    ];
  });
  return withSeq(usable);
}

/**
 * Classe do papel pelo ISIN da B3: `BRPETRACNOR9` é PETR3 (ON), `BRPETRACNPR6` é PETR4 (PN),
 * `BRTAEECDAM10` é TAEE11 (unit). Séries antigas da mesma classe (`BRBBASA04OR8`) caem no mesmo código.
 * Fora disso (debênture, recibo, BDR) devolve null.
 */
export function b3TickerOfIsin(isin: string): string | null {
  if (!/^BR[A-Z0-9]{4}[A-Z0-9]{3}[A-Z0-9]{2}\d$/.test(isin)) return null;
  const root = isin.slice(2, 6);
  if (isin.slice(6, 10) === "CDAM") return `${root}11`;
  const suffix: Record<string, string> = { OR: "3", PR: "4", PA: "5", PB: "6", PC: "7", PD: "8" };
  const code = suffix[isin.slice(9, 11)];
  return code ? `${root}${code}` : null;
}

/** Fatores da B3: desdobramento e bonificação em % a acrescentar; grupamento é o próprio multiplicador. */
const B3_STOCK_EVENTS: Record<string, (pct: string) => { factor: string; note: string }> = {
  DESDOBRAMENTO: (pct) => {
    const factor = money(1).plus(money(pct).dividedBy(100));
    const whole = factor.isInteger();
    return {
      factor: factor.toFixed(8),
      note: whole ? `Desdobramento de ${factor.toFixed(0)} para 1` : `Desdobramento de ${pct}%`,
    };
  },
  BONIFICACAO: (pct) => ({
    factor: money(1).plus(money(pct).dividedBy(100)).toFixed(8),
    note: `Bonificação de ${money(pct)
      .toFixed(2)
      .replace(/\.?0+$/, "")}%`,
  }),
  GRUPAMENTO: (factor) => {
    const inverse = money(factor).isZero() ? money(0) : money(1).dividedBy(factor);
    return {
      factor: money(factor).toFixed(8),
      note: inverse.isInteger() ? `Grupamento de ${inverse.toFixed(0)} para 1` : "Grupamento",
    };
  },
};

export interface B3CompanyEvents {
  dividends: MarketDividendRow[];
  /** Desdobramentos, grupamentos e bonificações da classe do papel, do mais antigo ao mais novo. */
  stockEvents: Array<StockEvent & { note: string }>;
}

/**
 * Proventos e eventos de uma ação direto da B3 (empresas listadas), pela raiz do código (PETR). A
 * resposta traz todas as classes da emissora, cada uma pelo ISIN: fica só o que é deste código. O valor
 * por ação é o pago na data, sem ajuste por eventos posteriores (ADR-0035).
 */
export async function fetchB3CompanyEvents(
  ticker: string,
  options: MarketClientOptions,
): Promise<B3CompanyEvents> {
  const payload = Buffer.from(
    JSON.stringify({ issuingCompany: b3FundIdentifier(ticker), language: "pt-br" }),
  ).toString("base64");
  const body = await getB3(`${B3_COMPANIES_URL}/GetListedSupplementCompany/${payload}`, options);
  const first = Array.isArray(body) ? body[0] : body;
  if (first == null) throw new MarketError("nao_encontrado");
  const parsed = b3Supplement.safeParse(first);
  if (!parsed.success) throw new MarketError("formato");
  const own = (isin: string | null | undefined) => isin != null && b3TickerOfIsin(isin) === ticker;
  const since = shiftYears(options.today, -MARKET_RULES.historyYears);
  const dividends = parseEach(b3CashDividend, parsed.data.cashDividends).flatMap((row) => {
    const kind = LABEL_KINDS[row.label.trim().toUpperCase()];
    if (!kind || !row.paymentDate || !own(row.assetIssued)) return [];
    const comDate = isoFromB3(row.lastDatePrior);
    const ratePerShare = money(decimalFromB3(row.rate)).toFixed(8);
    if (comDate < since || money(ratePerShare).lte(0)) return [];
    return [
      {
        ticker,
        kind,
        comDate,
        exDate: null,
        payDate: isoFromB3(row.paymentDate),
        ratePerShare,
        seq: 1,
        source: B3_SOURCE,
      },
    ];
  });
  const events = parseEach(b3StockDividend, parsed.data.stockDividends).flatMap((row) => {
    const build = B3_STOCK_EVENTS[row.label.trim().toUpperCase()];
    if (!build || !own(row.assetIssued)) return [];
    const { factor, note } = build(decimalFromB3(row.factor));
    return [{ comDate: isoFromB3(row.lastDatePrior), factor, note: note.slice(0, 120) }];
  });
  const stockEvents = [
    ...new Map(
      storableStockEvents(events).map((event) => [`${event.comDate}|${event.note}`, event]),
    ).values(),
  ].sort((a, b) => a.comDate.localeCompare(b.comDate));
  return { dividends: withSeq(dividends), stockEvents };
}

const b3CompanyPage = z.object({
  page: z.object({ totalPages: z.number().int().nonnegative().nullish() }),
  results: z.array(z.unknown()),
});
const b3Company = z.object({
  issuingCompany: z.string(),
  tradingName: z.string(),
  companyName: z.string(),
  codeCVM: z.string().nullish(),
  /** 1 = ação negociada; 4 = BDR; 7 = registrada sem negociação (debênture, fundo fechado). */
  type: z.string(),
  market: z.string().nullish(),
  status: z.string().nullish(),
});
/** A rota recusa páginas maiores: devolve vazio. */
const B3_COMPANY_PAGE = 120;
const B3_COMPANY_MAX_PAGES = 60;

/**
 * Emissoras listadas na B3 (ADR-0036): nome de pregão, razão social e raiz do código, em páginas de
 * 120. Só ações (`type` 1) e BDRs (`type` 4) ativas: o resto são registros sem negociação.
 */
export async function fetchB3Issuers(
  options: MarketClientOptions,
  sleep: (ms: number) => Promise<void> = async () => undefined,
): Promise<{ rows: MarketIssuerRow[]; pages: number }> {
  const rows: MarketIssuerRow[] = [];
  let pages = 0;
  for (let page = 1; page <= B3_COMPANY_MAX_PAGES; page += 1) {
    if (page > 1) await sleep(0);
    const payload = Buffer.from(
      JSON.stringify({ language: "pt-br", pageNumber: page, pageSize: B3_COMPANY_PAGE }),
    ).toString("base64");
    const parsed = b3CompanyPage.safeParse(
      await getB3(`${B3_COMPANIES_URL}/GetInitialCompanies/${payload}`, options),
    );
    if (!parsed.success) throw new MarketError("formato");
    pages += 1;
    for (const row of parseEach(b3Company, parsed.data.results)) {
      const kind = row.type === "1" ? "acao" : row.type === "4" ? "bdr" : null;
      const issuer = row.issuingCompany.trim().toUpperCase();
      if (!kind || row.status !== "A" || !/^[A-Z0-9]{4}$/.test(issuer)) continue;
      rows.push({
        issuer,
        tradingName: row.tradingName.trim().slice(0, 40) || issuer,
        companyName: row.companyName.trim().slice(0, 160) || issuer,
        kind,
        segment: row.market?.trim().slice(0, 10) || null,
        codeCvm: row.codeCVM?.trim().slice(0, 10) || null,
        source: B3_SOURCE,
      });
    }
    const total = parsed.data.page.totalPages ?? 0;
    if (page >= total) break;
  }
  return { rows, pages };
}
