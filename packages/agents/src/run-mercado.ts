// Coleta diária de dados de mercado (ADR-0017). Roda no worker, fora de withHousehold: percorre as
// famílias só para saber quais tickers existem, sem guardar quem tem o quê, e grava nas tabelas
// globais. Consulta cada ticker uma vez. Logs só com contagens e código de erro.
import {
  addMarketCalls,
  fromJob,
  householdCurrency,
  inArray,
  investments,
  lastMarketFxDate,
  listActiveHouseholdIds,
  readFamilyAccess,
  readPlatformFlags,
  listMarketTickers,
  marketCallsOn,
  MARKET_INDEX_CODES,
  recordAgentRun,
  saveMarketAssets,
  saveMarketDividends,
  saveMarketFx,
  saveMarketIndices,
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
  BRAPI_SOURCE,
  fetchB3FiiDividends,
  fetchBrapiCatalog,
  fetchBrapiQuote,
  fetchFiiDividends,
  fetchFxSeries,
  fetchSgsSeries,
  fetchYahooQuote,
  MarketError,
  YAHOO_SOURCE,
  type MarketErrorCode,
} from "./market";
import { shiftDays } from "./shared";

export const MERCADO_AGENT = "mercado";
/** Teto padrão de chamadas por dia: 400 × 31 fica abaixo das 15.000 do plano grátis. */
export const DEFAULT_MAX_CALLS_PER_DAY = 400;
/** O plano grátis aceita uma chamada por vez; a pausa evita encostar nisso. */
export const DEFAULT_PAUSE_MS = 300;
/** Código que a fonte não reconhece só é consultado de novo depois disto. */
export const UNKNOWN_RETRY_DAYS = 30;
/** Um ticker consultado há menos que isto fica de fora: a rodada seguinte cobre só o que faltou. */
export const CHECK_INTERVAL_MS = 12 * 3_600_000;
/** No pregão a cotação muda; entre duas coletas horárias basta este intervalo (ADR-0033). */
export const QUOTES_INTERVAL_MS = 50 * 60_000;
/** Proventos são conferidos na rodada completa de todo dia (ADR-0033). */
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
  /** Atualiza o catálogo de ativos. O job do worker sempre liga. */
  catalog?: boolean;
  /**
   * `quotes` (ADR-0033): só cotação, de hora em hora com a bolsa aberta; nada de índices, câmbio,
   * catálogo ou proventos. `full` é a rodada de fechamento e da madrugada.
   */
  mode?: MarketRunMode;
  log: Log;
  token?: string | undefined;
  maxCallsPerDay?: number;
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
  calls: number;
  quotes: number;
  dividends: number;
  stockEvents: number;
  assets: number;
  indices: number;
  fx: number;
  unknown: number;
  noPlan: number;
  failed: number;
  /**
   * Tickers fora desta rodada: já consultados há pouco, ou os que sobraram quando a brapi mandou
   * parar. Sem token ou sem cota ninguém fica de fora: a cotação vem do Yahoo (ADR-0032).
   */
  skipped: number;
  /** Motivo de parar antes do fim: cota esgotada ou token recusado. */
  stoppedBy: MarketErrorCode | null;
}

const codeOf = (error: unknown): MarketErrorCode =>
  error instanceof MarketError ? error.code : "rede";

async function collectTickers(
  ids: string[],
  log: Log,
): Promise<{ tickers: Map<string, boolean>; failed: number }> {
  const tickers = new Map<string, boolean>();
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
        if (ticker) tickers.set(ticker, (tickers.get(ticker) ?? false) || row.assetClass === "fii");
      }
    } catch (error) {
      failed += 1;
      log.error({ code: (error as { code?: string }).code }, "mercado: leitura da carteira falhou");
    }
  }
  return { tickers, failed };
}

export async function runMarketData(options: MarketRunOptions): Promise<MarketRunResult> {
  const { log, token } = options;
  const mode: MarketRunMode = options.mode ?? "full";
  const quotesOnly = mode === "quotes";
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const today = todayIn(MARKET_RULES.timezone, now);
  const maxCalls = options.maxCallsPerDay ?? DEFAULT_MAX_CALLS_PER_DAY;
  const pause = options.pauseMs ?? DEFAULT_PAUSE_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const client = {
    token,
    today,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };

  const result: MarketRunResult = {
    households: 0,
    tickers: 0,
    calls: 0,
    quotes: 0,
    dividends: 0,
    stockEvents: 0,
    assets: 0,
    indices: 0,
    fx: 0,
    unknown: 0,
    noPlan: 0,
    failed: 0,
    skipped: 0,
    stoppedBy: null,
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

  if (!token) log.info({}, "mercado: sem BRAPI_TOKEN, cotações pelo Yahoo e rendimentos pela B3");
  const known = new Map((await listMarketTickers()).map((row) => [row.ticker, row]));
  const due = [...tickers.keys()]
    .filter((ticker) => {
      const row = known.get(ticker);
      if (!row) return true;
      // O que a brapi recusou por plano agora vem das fontes gratuitas: volta na mesma hora.
      if (row.retryOn && row.retryOn > today && row.status !== "sem_plano") return false;
      if (row.status === "falha" || row.status === "sem_plano") return true;
      // Na rodada completa, FII com proventos a conferir entra mesmo que a cotação seja recente:
      // a coleta horária não pode esconder a busca de rendimentos (ADR-0033).
      if (
        !quotesOnly &&
        tickers.get(ticker) &&
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
  if (due.some((ticker) => known.get(ticker)?.status === "sem_plano"))
    log.info({}, "mercado: tickers recusados pela brapi voltam pelas fontes gratuitas");

  let available = maxCalls - (await marketCallsOn(today));
  const spend = async () => {
    available -= 1;
    result.calls += 1;
    await addMarketCalls(today, 1);
  };

  // O catálogo vem primeiro: é uma chamada para a bolsa inteira, e o cadastro depende dele.
  if (options.catalog && !quotesOnly && available > 0) {
    try {
      const catalog = await fetchBrapiCatalog(client);
      for (let page = 0; page < catalog.pages; page += 1) await spend();
      result.assets = await saveMarketAssets(catalog.rows);
    } catch (error) {
      result.failed += 1;
      log.error({ code: codeOf(error) }, "mercado: catálogo de ativos falhou");
    }
  }

  /**
   * Fontes gratuitas (ADR-0032): cotação no Yahoo e, em FII, rendimentos na B3. Não gastam a cota
   * da brapi. Falha de rendimento não derruba a cotação: vira aviso e fica para a rodada seguinte.
   */
  const fetchFree = async (ticker: string) => {
    const quote = await fetchYahooQuote(ticker, client);
    await saveMarketQuote({
      ...quote,
      source: YAHOO_SOURCE,
      lastStockEventOn: null,
      lastStockEventNote: null,
    });
    result.quotes += 1;
    // Rendimentos: só na rodada completa, uma vez por dia por ativo (`dividendsRetryOn`).
    const row = known.get(ticker);
    const dividendsDue = !quotesOnly && (!row?.dividendsRetryOn || row.dividendsRetryOn <= today);
    let dividendsRetryOn: string | null = null;
    if (tickers.get(ticker) && dividendsDue) {
      await sleep(pause);
      try {
        result.dividends += await saveMarketDividends(await fetchB3FiiDividends(ticker, client));
        dividendsRetryOn = shiftDays(today, DIVIDENDS_INTERVAL_DAYS);
      } catch (error) {
        log.warn(
          { code: codeOf(error), source: B3_SOURCE },
          "mercado: rendimentos de FII indisponíveis",
        );
      }
    }
    await saveMarketTicker({
      ticker,
      status: "ok",
      retryOn: null,
      errorCode: null,
      dividendsRetryOn,
    });
  };

  for (const [index, ticker] of due.entries()) {
    if (index > 0) await sleep(pause);
    if (!token || available <= 0) {
      // Sem token, ou com a cota da brapi esgotada, tudo vem das fontes gratuitas.
      try {
        await fetchFree(ticker);
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
      continue;
    }
    try {
      await spend();
      const { dividends, stockEvents, ...quote } = await fetchBrapiQuote(ticker, client);
      await saveMarketQuote({ ...quote, source: BRAPI_SOURCE });
      result.quotes += 1;
      result.dividends += await saveMarketDividends(dividends);
      result.stockEvents += await saveMarketStockEvents(
        stockEvents.map((event) => ({ ...event, ticker, source: BRAPI_SOURCE })),
      );

      // FII: a rota de ações não traz rendimentos; a própria tem uma chamada a mais.
      let dividendsRetryOn: string | null = null;
      const row = known.get(ticker);
      const fiiDue = !row?.dividendsRetryOn || row.dividendsRetryOn <= today;
      if (!quotesOnly && tickers.get(ticker) && dividends.length === 0 && fiiDue && available > 0) {
        await sleep(pause);
        await spend();
        try {
          result.dividends += await saveMarketDividends(await fetchFiiDividends(ticker, client));
        } catch (error) {
          const code = codeOf(error);
          if (code === "plano") dividendsRetryOn = shiftDays(today, UNKNOWN_RETRY_DAYS);
          log.warn({ code }, "mercado: rendimentos de FII indisponíveis");
        }
      }
      await saveMarketTicker({
        ticker,
        status: "ok",
        retryOn: null,
        errorCode: null,
        dividendsRetryOn,
      });
    } catch (error) {
      const code = codeOf(error);
      if (code === "limite" || code === "token_invalido" || code === "sem_token") {
        // Insistir só piora: exceder a cota pode encerrar a licença.
        result.stoppedBy = code;
        result.skipped += due.length - index;
        log.error({ code }, "mercado: rodada interrompida");
        break;
      }
      if (code === "nao_encontrado" || code === "plano") {
        // A brapi não cobre o ticker: as fontes gratuitas cobrem. Só desiste se elas também falharem.
        if (code === "plano") result.noPlan += 1;
        try {
          await fetchFree(ticker);
          continue;
        } catch (fallback) {
          const freeCode = codeOf(fallback);
          if (freeCode !== "nao_encontrado") {
            result.failed += 1;
            log.error(
              { code: freeCode, source: YAHOO_SOURCE },
              "mercado: consulta de ticker falhou",
            );
            await saveMarketTicker({ ticker, status: "falha", retryOn: null, errorCode: freeCode });
            continue;
          }
        }
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
      log.error({ code }, "mercado: consulta de ticker falhou");
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
