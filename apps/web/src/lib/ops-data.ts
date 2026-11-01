import {
  databaseStatus,
  findAgentMemories,
  listAgentRuns,
  listCategorizationStats,
  listDeployments,
  listDiagnosticRates,
  listDiagnostics,
  listReports,
  listWorkerHeartbeats,
} from "@organizeup/db";
import { z } from "zod";

/** O que um agente lê ao acordar. Mesma resposta na Ops API e no MCP. */
export async function loadOpsContext(input: {
  agent?: string | undefined;
  query?: string | undefined;
}) {
  const { agent, query } = input;
  const [
    database,
    deployments,
    workers,
    reports,
    own,
    team,
    categorization,
    agentRuns,
    diagnostics,
    errorRates,
  ] = await Promise.all([
    databaseStatus(),
    listDeployments(5),
    listWorkerHeartbeats(),
    listReports({ limit: 5 }),
    agent ? findAgentMemories({ agent, query }) : Promise.resolve([]),
    findAgentMemories({ query, limit: 10 }),
    listCategorizationStats(14),
    listAgentRuns(14),
    listDiagnostics({ limit: 20 }),
    listDiagnosticRates(5),
  ]);
  return {
    production: { commit: process.env.APP_COMMIT ?? "dev", database, deployments, workers },
    reports,
    memories: { own, team },
    categorization,
    agentRuns,
    diagnostics,
    errorRates,
  };
}

export async function loadOpsDeployments(limit: number) {
  const [deployments, workers] = await Promise.all([
    listDeployments(limit),
    listWorkerHeartbeats(),
  ]);
  return { current: { web: process.env.APP_COMMIT ?? "dev" }, deployments, workers };
}

/** Filtros de leitura dos erros, iguais na Ops API e no MCP. */
export const diagnosticFiltersSchema = z.object({
  status: z.enum(["aberto", "resolvido", "todos"]).optional(),
  service: z.enum(["web", "worker"]).optional(),
  source: z.enum(["render", "route", "action", "proxy", "client", "job", "agent"]).optional(),
  commit: z.string().trim().min(1).max(64).optional(),
  route: z.string().trim().min(1).max(200).optional(),
  fingerprint: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
  since: z.union([z.iso.date(), z.iso.datetime({ offset: true })]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const resolveDiagnosticSchema = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{32}$/, "Use a impressão digital do erro."),
});

export async function loadDiagnostics({
  since,
  ...filters
}: z.output<typeof diagnosticFiltersSchema>) {
  const [diagnostics, errorRates] = await Promise.all([
    listDiagnostics({ ...filters, ...(since ? { since: new Date(since) } : {}) }),
    listDiagnosticRates(5),
  ]);
  return { diagnostics, errorRates };
}
