// Job `market-data` (ADR-0017): cotações, proventos e índices públicos, gravados nas tabelas globais
// antes de os agentes da madrugada lerem. A rotina fica em @organizeup/agents.
import {
  DEFAULT_MAX_CALLS_PER_DAY,
  MERCADO_AGENT,
  runMarketData,
  type MarketRunMode,
} from "@organizeup/agents";
import { readPlatformFlags } from "@organizeup/db";
import { ACTIVE_DAYS } from "./daily-agents";

interface Log {
  error: (data: object, message: string) => void;
  info: (data: object, message: string) => void;
  warn: (data: object, message: string) => void;
}

/**
 * Fechamento, madrugada (antes dos agentes das 04:00) e, com a bolsa aberta, uma coleta só de
 * cotação a cada hora cheia das 10h às 17h (ADR-0033). Feriados da B3 não são conhecidos: nesses
 * dias a coleta horária só repete a última cotação, e o histórico não duplica.
 */
export const MARKET_SCHEDULES = [
  { key: "fechamento", cron: "30 18 * * 1-5", mode: "full" },
  { key: "madrugada", cron: "30 3 * * 2-6", mode: "full" },
  { key: "pregao", cron: "0 10-17 * * 1-5", mode: "quotes" },
] as const satisfies ReadonlyArray<{ key: string; cron: string; mode: MarketRunMode }>;

export interface MarketDataJob {
  mode?: MarketRunMode;
}

export function maxCallsPerDay(): number {
  const parsed = Number.parseInt(process.env.BRAPI_MAX_CALLS_PER_DAY ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_CALLS_PER_DAY;
}

export async function runMarketDataJob(log: Log, job: MarketDataJob = {}): Promise<void> {
  // Como os outros agentes: o painel desliga, e o modo manutenção para tudo.
  const flags = await readPlatformFlags();
  if (flags.maintenance || flags.disabledAgents.includes(MERCADO_AGENT)) {
    log.info({}, "mercado pulado: desligado no painel");
    return;
  }
  await runMarketData({
    log,
    mode: job.mode ?? "full",
    catalog: true,
    token: process.env.BRAPI_TOKEN || undefined,
    maxCallsPerDay: maxCallsPerDay(),
    activeDays: ACTIVE_DAYS,
  });
}
