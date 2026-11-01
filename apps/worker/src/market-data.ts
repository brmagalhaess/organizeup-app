// Job `market-data` (ADR-0017): cotações, proventos e índices públicos, gravados nas tabelas globais
// antes de os agentes da madrugada lerem. A rotina fica em @organizeup/agents.
import { DEFAULT_MAX_CALLS_PER_DAY, runMarketData } from "@organizeup/agents";
import { ACTIVE_DAYS } from "./daily-agents";

interface Log {
  error: (data: object, message: string) => void;
  info: (data: object, message: string) => void;
  warn: (data: object, message: string) => void;
}

/** Fim do pregão regular e madrugada seguinte, antes dos agentes das 04:00. */
export const MARKET_SCHEDULES = [
  { key: "fechamento", cron: "30 18 * * 1-5" },
  { key: "madrugada", cron: "30 3 * * 2-6" },
] as const;

function maxCallsPerDay(): number {
  const parsed = Number.parseInt(process.env.BRAPI_MAX_CALLS_PER_DAY ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_CALLS_PER_DAY;
}

export async function runMarketDataJob(log: Log): Promise<void> {
  await runMarketData({
    log,
    catalog: true,
    token: process.env.BRAPI_TOKEN || undefined,
    maxCallsPerDay: maxCallsPerDay(),
    activeDays: ACTIVE_DAYS,
  });
}
