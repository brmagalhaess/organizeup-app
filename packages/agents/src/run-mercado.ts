// Coleta diária de dados de mercado (ADR-0017). Roda no worker, fora de withHousehold: percorre as
// famílias só para saber quais tickers existem, sem guardar quem tem o quê, e grava nas tabelas
// globais. Consulta cada ticker uma vez. Logs só com contagens e código de erro.
import {
  fromJob,
  householdCurrency,
  inArray,
  investments,
  lastMarketFxDate,
  listActiveHouseholdIds,
  readFamilyAccess,
  readPlatformFlags,
  listMarketTickers,
  MARKET_INDEX_CODES,
  recordAgentRun,
  saveMarketAssets,
  saveMarketDividends,
  saveMarketFx,
  saveMarketIndices,
  saveMarketIssuers,
  saveMarketQuote,
  saveMarketStockEvents,
  saveMarketTicker,
  withWorkerHousehold,
} from "@organizeup/db";
import {
  brazilRulesApply,
  canUse,
  FX_CURRENCIES,
  MARKET_RULES,
  normalizeTicker,
  shiftYears,
  todayIn,
} from "@organizeup/domain";
import {
  B3_SOURCE,
  fetchB3CompanyEvents,
  fetchB3FiiDividends,
  fetchB3Issuers,
  fetchBrapiCatalog,
  fetchFxSeries,
  fetchSgsSeries,
  fetchYahooBookValue,
  fetchYahooQuote,
  MarketError,
  YAHOO_SOURCE,
  type MarketErrorCode,
} from "./market";
import { shiftDays } from "./shared";

export const MERCADO_AGENT = "mercado";
/** Pausa entre consultas: as rotas públicas não declaram cota, e espaçar evita bloqueio. */
export const DEFAULT_PAUSE_MS = 300;
/** Código que a fonte não reconhece só é consultado de novo depois disto. */
export const UNKNOWN_RETRY_DAYS = 30;
/** Um ticker consultado há menos que isto fica de fora: a rodada seguinte cobre só o que faltou. */
export const CHECK_INTERVAL_MS = 12 * 3_600_000;
/** No pregão a cotação muda; entre duas coletas horárias basta este intervalo (ADR-0033). */
export const QUOTES_INTERVAL_MS = 50 * 60_000;
/** Proventos e eventos são conferidos na rodada completa de todo dia (ADR-0033). */
export const DIVIDENDS_INTERVAL_DAYS = 1;
/** Lançamento antigo precisa da cotação da data dele: a primeira rodada traz tudo isto. */
export const FX_HISTORY_YEARS = 10;
/** O histórico vem em blocos: uma resposta pequena, e quem falha no meio retoma de onde parou. */
export const FX_BLOCK_YEARS = 2;

const PRICED_CLASSES = ["acao", "fii", "etf_bdr"] as const;

interface Log {
  error: (data: object, message: string) => void;
  info: (data: object, message: string) => void;
  warn: (data: object, message: string) => void;
}

export type MarketRunMode = "full" | "quotes";

export interface MarketRunOptions {
  /** Atualiza o catálogo de nomes. O job do worker sempre liga. */
  catalog?: boolean;
  /**
   * `quotes` (ADR-0033): só cotação, de hora em hora com a bolsa aberta; nada de índices, câmbio,
   * catálogo ou proventos. `full` é a rodada de fechamento e da madrugada.
   */
  mode?: MarketRunMode;
  log: Log;
  /** Famílias com sessão nestes dias entram na coleta. */
  activeDays: number;
  pauseMs?: number;
  fetch?: typeof fetch;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface MarketRunResult {
  households: number;
  tickers: number;
  quotes: number;
  dividends: number;
  stockEvents: number;
  assets: number;
  /** Emissoras da B3 gravadas (ADR-0036). */
  issuers: number;
  /** VPA encontrados no Yahoo nesta rodada. */
  bookValues: number;
  indices: number;
  fx: number;
  unknown: number;
  failed: number;
  /** Tickers fora desta rodada: já consultados há pouco. */
  skipped: number;
}

const codeOf = (error: unknown): MarketErrorCode =>
  error instanceof MarketError ? error.code : "rede";

type PricedClass = (typeof PRICED_CLASSES)[number];

/** Quem traz proventos: ações e FIIs pela B3; ETF e BDR só têm cotação. */
const hasDividends = (assetClass: PricedClass | undefined) =>
  assetClass === "acao" || assetClass === "fii";

async function collectTickers(
  ids: string[],
  log: Log,
): Promise<{ tickers: Map<string, PricedClass>; failed: number }> {
  const tickers = new Map<string, PricedClass>();
  let failed = 0;
  const flags = await readPlatformFlags();
  for (const householdId of ids) {
    try {
      // Família sem o módulo não pede cotação: os dados ficam guardados e voltam ao religar.
      const access = await readFamilyAccess(fromJob({ householdId }), flags);
      if (!canUse(access, "investimentos")) continue;
      const rows = await withWorkerHousehold(householdId, async (tx) =>
        brazilRulesApply(await householdCurrency(tx))
          ? tx
              .select({ ticker: investments.ticker, assetClass: investments.assetClass })
              .from(investments)
              .where(inArray(investments.assetClass, [...PRICED_CLASSES]))
          : [],
      );
      for (const row of rows) {
        const ticker = normalizeTicker(row.ticker);
        if (!ticker) continue;
        // Duas famílias com classes diferentes para o mesmo código: fica a que traz proventos.
        const current = tickers.get(ticker);
        if (!current || (!hasDividends(current) && hasDividends(row.assetClass as PricedClass))) {
          tickers.set(ticker, row.assetClass as PricedClass);
        }
      }
    } catch (error) {
      failed += 1;
      log.error({ code: (error as { code?: string }).code }, "mercado: leitura da carteira falhou");
    }
  }
  return { tickers, failed };
}

export async function runMarketData(options: MarketRunOptions): Promise<MarketRunResult> {
  const { log } = options;
  const mode: MarketRunMode = options.mode ?? "full";
  const quotesOnly = mode === "quotes";
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const today = todayIn(MARKET_RULES.timezone, now);
  const pause = options.pauseMs ?? DEFAULT_PAUSE_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const client = { today, ...(options.fetch ? { fetch: options.fetch } : {}) };

  const result: MarketRunResult = {
    households: 0,
    tickers: 0,
    quotes: 0,
    dividends: 0,
    stockEvents: 0,
    assets: 0,
    issuers: 0,
    bookValues: 0,
    indices: 0,
    fx: 0,
    unknown: 0,
    failed: 0,
    skipped: 0,
  };

  // Índices primeiro: são de graça e não dependem de carteira.
  for (const code of quotesOnly ? [] : MARKET_INDEX_CODES) {
    try {
      result.indices += await saveMarketIndices(await fetchSgsSeries(code, client));
    } catch (error) {
      result.failed += 1;
      log.error({ code: codeOf(error) }, "mercado: índice do Banco Central falhou");
    }
  }

  // Câmbio: do dia seguinte ao último gravado até hoje. Falhar deixa o resto para a próxima rodada.
  for (const currency of quotesOnly ? [] : FX_CURRENCIES) {
    try {
      const last = await lastMarketFxDate(currency);
      let from = last ? shiftDays(last, 1) : shiftYears(today, -FX_HISTORY_YEARS);
      while (from <= today) {
        const end = shiftDays(shiftYears(from, FX_BLOCK_YEARS), -1);
        const to = end < today ? end : today;
        result.fx += await saveMarketFx(await fetchFxSeries(currency, from, to, client));
        from = shiftDays(to, 1);
        if (from <= today) await sleep(pause);
      }
    } catch (error) {
      result.failed += 1;
      log.error({ code: codeOf(error) }, "mercado: câmbio do Banco Central falhou");
    }
  }

  const ids = await listActiveHouseholdIds(options.activeDays);
  const { tickers, failed } = await collectTickers(ids, log);
  result.households = ids.length;
  result.tickers = tickers.size;
  result.failed += failed;

  const known = new Map((await listMarketTickers()).map((row) => [row.ticker, row]));
  const due = [...tickers.keys()]
    .filter((ticker) => {
      const row = known.get(ticker);
      if (!row) return true;
      if (row.retryOn && row.retryOn > today) return false;
      if (row.status === "falha" || row.status === "sem_plano") return true;
      // Na rodada completa, quem tem proventos a conferir entra mesmo que a cotação seja recente:
      // a coleta horária não pode esconder a busca de proventos (ADR-0033).
      if (
        !quotesOnly &&
        hasDividends(tickers.get(ticker)) &&
        (!row.dividendsRetryOn || row.dividendsRetryOn <= today)
      )
        return true;
      return (
        now.getTime() - row.checkedAt.getTime() >=
        (quotesOnly ? QUOTES_INTERVAL_MS : CHECK_INTERVAL_MS)
      );
    })
    // Os mais antigos primeiro: quem nunca foi consultado vem na frente.
    .sort(
      (a, b) => (known.get(a)?.checkedAt.getTime() ?? 0) - (known.get(b)?.checkedAt.getTime() ?? 0),
    );
  result.skipped = tickers.size - due.length;

  // O catálogo de nomes vem primeiro: uma chamada para a bolsa inteira, e o cadastro depende dele.
  if (options.catalog && !quotesOnly) {
    try {
      const catalog = await fetchBrapiCatalog(client);
      result.assets = await saveMarketAssets(catalog.rows);
    } catch (error) {
      result.failed += 1;
      log.error({ code: codeOf(error) }, "mercado: catálogo de ativos falhou");
    }
    // Emissoras da B3 (ADR-0036): o nome de pregão que a nota de corretagem imprime, com a raiz do código.
    try {
      const issuers = await fetchB3Issuers(client, () => sleep(pause));
      result.issuers = await saveMarketIssuers(issuers.rows);
    } catch (error) {
      result.failed += 1;
      log.error({ code: codeOf(error) }, "mercado: emissoras da B3 falharam");
    }
  }

  /**
   * Proventos e eventos na rodada completa, uma vez por dia por ativo (`dividendsRetryOn`): FII pela
   * lista de fundos da B3, ação pela lista de empresas (ADR-0035). Falha aqui não derruba a cotação:
   * vira aviso e fica para a rodada seguinte. Devolve a data para a próxima conferência e o último
   * evento, que a cotação guarda.
   */
  const fetchDividends = async (ticker: string) => {
    const assetClass = tickers.get(ticker);
    const row = known.get(ticker);
    const due = !quotesOnly && (!row?.dividendsRetryOn || row.dividendsRetryOn <= today);
    const none = { dividendsRetryOn: null, lastStockEventOn: null, lastStockEventNote: null };
    if (!hasDividends(assetClass) || !due) return none;
    await sleep(pause);
    // VPA no mesmo dia dos proventos: uma consulta a mais por ativo, só na rodada completa.
    const book = await fetchBookValue(ticker);
    try {
      if (assetClass === "fii") {
        result.dividends += await saveMarketDividends(await fetchB3FiiDividends(ticker, client));
        return { ...none, ...book, dividendsRetryOn: shiftDays(today, DIVIDENDS_INTERVAL_DAYS) };
      }
      const { dividends, stockEvents } = await fetchB3CompanyEvents(ticker, client);
      result.dividends += await saveMarketDividends(dividends);
      result.stockEvents += await saveMarketStockEvents(
        stockEvents.map((event) => ({ ...event, ticker, source: B3_SOURCE })),
      );
      const latest = stockEvents.at(-1);
      return {
        ...book,
        dividendsRetryOn: shiftDays(today, DIVIDENDS_INTERVAL_DAYS),
        lastStockEventOn: latest?.comDate ?? null,
        lastStockEventNote: latest?.note ?? null,
      };
    } catch (error) {
      log.warn(
        { code: codeOf(error), source: B3_SOURCE },
        assetClass === "fii"
          ? "mercado: rendimentos de FII indisponíveis"
          : "mercado: proventos da ação indisponíveis",
      );
      return { ...none, ...book };
    }
  };

  /** VPA pelo Yahoo. Sem balanço ou com a fonte indisponível, o valor anterior fica (campos ausentes). */
  const fetchBookValue = async (
    ticker: string,
  ): Promise<{ bookValuePerShare?: string; bookValueAsOf?: string }> => {
    try {
      const found = await fetchYahooBookValue(ticker, client);
      if (!found) return {};
      result.bookValues += 1;
      return { bookValuePerShare: found.bookValuePerShare, bookValueAsOf: found.asOfDate };
    } catch (error) {
      log.warn({ code: codeOf(error), source: YAHOO_SOURCE }, "mercado: VPA indisponível");
      return {};
    }
  };

  for (const [index, ticker] of due.entries()) {
    if (index > 0) await sleep(pause);
    try {
      const quote = await fetchYahooQuote(ticker, client);
      const { dividendsRetryOn, ...events } = await fetchDividends(ticker);
      await saveMarketQuote({ ...quote, source: YAHOO_SOURCE, ...events });
      result.quotes += 1;
      await saveMarketTicker({
        ticker,
        status: "ok",
        retryOn: null,
        errorCode: null,
        dividendsRetryOn,
      });
    } catch (error) {
      const code = codeOf(error);
      if (code === "nao_encontrado") {
        result.unknown += 1;
        await saveMarketTicker({
          ticker,
          status: "desconhecido",
          retryOn: shiftDays(today, UNKNOWN_RETRY_DAYS),
          errorCode: code,
        });
        continue;
      }
      result.failed += 1;
      log.error({ code, source: YAHOO_SOURCE }, "mercado: consulta de ticker falhou");
      await saveMarketTicker({ ticker, status: "falha", retryOn: null, errorCode: code });
    }
  }

  await recordAgentRun(today, MERCADO_AGENT, {
    households: result.households,
    ok: result.quotes,
    failed: result.failed,
    suggestions: 0,
    applied: result.dividends + result.stockEvents + result.indices + result.fx,
    durationMs: Date.now() - startedAt,
  });
  log.info({ ...result, mode }, "mercado: rodada concluída");
  return result;
}
