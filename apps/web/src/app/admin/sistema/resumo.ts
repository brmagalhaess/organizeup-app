// Contas dos blocos da tela Sistema. Funções puras sobre as linhas de `ops`: só somas, sem família.

export interface AiStatRow {
  day: string;
  route: string;
  calls: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Decimal em string, como vem do numeric. Dólar do fornecedor, não dinheiro de família. */
  costUsd: string;
}

export interface AiTotals {
  calls: number;
  costUsd: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const ROUTE_LABELS: Record<string, string> = {
  chat: "Conversa",
  noite: "Dicas da madrugada",
  teste: "Testar a IA",
};

/** Rota nova em `ops.ai_stats` aparece com o próprio nome até ganhar um rótulo. */
export const routeLabel = (route: string) => ROUTE_LABELS[route] ?? route;

const emptyTotals = (): AiTotals => ({
  calls: 0,
  costUsd: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

function addTo(totals: AiTotals, row: AiStatRow) {
  totals.calls += row.calls;
  totals.costUsd += Number(row.costUsd);
  totals.inputTokens += row.inputTokens;
  totals.cacheReadTokens += row.cacheReadTokens;
  totals.cacheWriteTokens += row.cacheWriteTokens;
}

/** Quanto da entrada veio do cache. Perto de zero com uso alto, o cache de prompt quebrou. */
export function cacheShare(usage: {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}) {
  const total = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return total === 0 ? "sem uso" : `${Math.round((usage.cacheReadTokens / total) * 100)}%`;
}

/** Soma por rota, da que mais gastou para a que menos gastou. */
export function aiByRoute(rows: AiStatRow[]) {
  const routes = new Map<string, AiTotals>();
  for (const row of rows) {
    const totals = routes.get(row.route) ?? emptyTotals();
    addTo(totals, row);
    routes.set(row.route, totals);
  }
  return [...routes.entries()]
    .map(([route, totals]) => ({ route, ...totals }))
    .sort((a, b) => b.costUsd - a.costUsd || a.route.localeCompare(b.route));
}

/** Um item por dia pedido, com zero nos dias sem uso, para o gráfico não pular datas. */
export function aiByDay(rows: AiStatRow[], days: string[]) {
  return days.map((day) => {
    const ofDay = rows.filter((row) => row.day === day);
    const totals = emptyTotals();
    for (const row of ofDay) addTo(totals, row);
    return { day, ...totals, routes: aiByRoute(ofDay) };
  });
}

export interface InsightRunRow {
  day: string;
  agent: string;
  ok: number;
  failed: number;
  suggestions: number;
}

/** Rodadas das dicas com os descartes de cada dia, do dia mais novo ao mais antigo. */
export function insightsByDay(
  runs: InsightRunRow[],
  discards: Array<{ day: string; agent: string; discarded: number }>,
  agent: string,
  since: string,
) {
  const discardedOn = (day: string) =>
    discards.find((row) => row.agent === agent && row.day === day)?.discarded ?? 0;
  return runs
    .filter((run) => run.agent === agent && run.day >= since)
    .map((run) => ({
      day: run.day,
      families: run.ok,
      failed: run.failed,
      created: run.suggestions,
      discarded: discardedOn(run.day),
    }))
    .sort((a, b) => b.day.localeCompare(a.day));
}
