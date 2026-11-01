// Coleta diária de dados de mercado (ADR-0017). Roda no worker, fora de withHousehold: percorre as
// famílias só para saber quais tickers existem, sem guardar quem tem o quê, e grava nas tabelas
// globais. Consulta cada ticker uma vez. Logs só com contagens e código de erro.
import {
  addMarketCalls,
  inArray,
  investments,
  listActiveHouseholdIds,
  listMarketTickers,
  marketCallsOn,
  MARKET_INDEX_CODES,
  recordAgentRun,
  saveMarketDividends,
  saveMarketIndices,
  saveMarketQuote,
  saveMarketStockEvents,
  saveMarketTicker,
  withWorkerHousehold,
} from "@organizeup/db";
import { MARKET_RULES, normalizeTicker, todayIn } from "@organizeup/domain";
import {
  BRAPI_SOURCE,
  fetchBrapiQuote,
  fetchFiiDividends,
  fetchSgsSeries,
  KEYLESS_TICKERS,
  MarketError,
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

const PRICED_CLASSES = ["acao", "fii", "etf_bdr"] as const;

interface Log {
  error: (data: object, message: string) => void;
  info: (data: object, message: string) => void;
  warn: (data: object, message: string) => void;
}

export interface MarketRunOptions {
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
  indices: number;
  unknown: number;
  noPlan: number;
  failed: number;
  /** Tickers fora desta rodada: já consultados há pouco, sem token, ou sem cota. */
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
  for (const householdId of ids) {
    try {
      const rows = await withWorkerHousehold(householdId, (tx) =>
        tx
          .select({ ticker: investments.ticker, assetClass: investments.assetClass })
          .from(investments)
          .where(inArray(investments.assetClass, [...PRICED_CLASSES])),
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
    indices: 0,
    unknown: 0,
    noPlan: 0,
    failed: 0,
    skipped: 0,
    stoppedBy: null,
  };

  // Índices primeiro: são de graça e não dependem de carteira.
  for (const code of MARKET_INDEX_CODES) {
    try {
      result.indices += await saveMarketIndices(await fetchSgsSeries(code, client));
    } catch (error) {
      result.failed += 1;
      log.error({ code: codeOf(error) }, "mercado: índice do Banco Central falhou");
    }
  }

  const ids = await listActiveHouseholdIds(options.activeDays);
  const { tickers, failed } = await collectTickers(ids, log);
  result.households = ids.length;
  result.tickers = tickers.size;
  result.failed += failed;

  if (!token) log.warn({}, "mercado: sem BRAPI_TOKEN, consultando só os tickers de teste");
  const known = new Map((await listMarketTickers()).map((row) => [row.ticker, row]));
  const due = [...tickers.keys()]
    .filter((ticker) => {
      if (!token && !KEYLESS_TICKERS.includes(ticker)) return false;
      const row = known.get(ticker);
      if (!row) return true;
      if (row.retryOn && row.retryOn > today) return false;
      if (row.status === "falha") return true;
      return now.getTime() - row.checkedAt.getTime() >= CHECK_INTERVAL_MS;
    })
    // Os mais antigos primeiro: quem nunca foi consultado vem na frente.
    .sort(
      (a, b) => (known.get(a)?.checkedAt.getTime() ?? 0) - (known.get(b)?.checkedAt.getTime() ?? 0),
    );
  result.skipped = tickers.size - due.length;

  let available = maxCalls - (await marketCallsOn(today));
  const spend = async () => {
    available -= 1;
    result.calls += 1;
    await addMarketCalls(today, 1);
  };

  for (const [index, ticker] of due.entries()) {
    if (available <= 0) {
      result.skipped += due.length - index;
      log.warn({ budget: maxCalls }, "mercado: teto de chamadas do dia atingido");
      break;
    }
    if (index > 0) await sleep(pause);
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
      if (tickers.get(ticker) && dividends.length === 0 && fiiDue && available > 0) {
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
        if (code === "nao_encontrado") result.unknown += 1;
        else result.noPlan += 1;
        await saveMarketTicker({
          ticker,
          status: code === "plano" ? "sem_plano" : "desconhecido",
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
    applied: result.dividends + result.stockEvents + result.indices,
    durationMs: Date.now() - startedAt,
  });
  log.info({ ...result }, "mercado: rodada concluída");
  return result;
}
