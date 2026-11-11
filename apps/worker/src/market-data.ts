// Job `market-data` (ADR-0017): cotações, proventos e índices públicos, gravados nas tabelas globais
// antes de os agentes da madrugada lerem. A rotina fica em @organizeup/agents.
import { MERCADO_AGENT, runMarketData, type MarketRunMode } from "@organizeup/agents";
import { readPlatformFlags } from "@organizeup/db";
import { ACTIVE_DAYS } from "./daily-agents";

interface Log {
  error: (data: object, message: string) => void;
  info: (data: object, message: string) => void;
  warn: (data: object, message: string) => void;
}

/**
 * Cotação de hora em hora, o dia inteiro, e uma rodada completa às 17:00 todo dia (ADR-0033, pedido
 * do fundador em 2026-11-09): a completa traz índices, câmbio, catálogo e proventos. Fora do pregão a
 * fonte repete a última cotação e o histórico não duplica.
 */
export const MARKET_SCHEDULES = [
  { key: "completa", cron: "0 17 * * *", mode: "full" },
  { key: "cotacoes", cron: "0 0-16,18-23 * * *", mode: "quotes" },
] as const satisfies ReadonlyArray<{ key: string; cron: string; mode: MarketRunMode }>;

/** Chaves de agendamento que já existiram no pg-boss e precisam ser removidas no boot. */
export const LEGACY_MARKET_KEYS = ["fechamento", "madrugada", "pregao"] as const;

export interface MarketDataJob {
  mode?: MarketRunMode;
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
    universe: true,
    activeDays: ACTIVE_DAYS,
  });
}
