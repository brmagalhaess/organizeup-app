// Diagnósticos: o que a equipe de agentes vê dos erros de web e worker (assistente-ia.md, seção 7).
// A mensagem do erro nunca é lida: ela pode trazer valor de família. Daqui só saem o nome do tipo,
// o código, a rota sem parâmetros e arquivo e linha do nosso código.
import { createHash } from "node:crypto";
import { and, desc, eq, gte, max, min, sql } from "drizzle-orm";
import { tolerateSchemaLag } from "./access";
import { appPool } from "./client";
import { diagnostics } from "./schema";

export type DiagnosticService = (typeof diagnostics.$inferInsert)["service"];
export type DiagnosticSource = (typeof diagnostics.$inferInsert)["source"];
export type DiagnosticStatus = NonNullable<(typeof diagnostics.$inferInsert)["status"]>;

export interface DiagnosticOrigin {
  service: DiagnosticService;
  source: DiagnosticSource;
  /** Rota do Next (`/app/metas/[id]`) ou nome fixo (`job:market-data`, `agente:metas`). */
  route: string;
  commit?: string | undefined;
}

export interface DiagnosticEvent {
  fingerprint: string;
  service: DiagnosticService;
  source: DiagnosticSource;
  errorType: string;
  route: string;
  commit: string;
  code: string | null;
  stack: string[];
}

/** O que um erro repetido ou um visitante mal-intencionado consegue gravar por dia. */
export const DIAGNOSTIC_LIMITS = { perFingerprintDay: 1000, newPerSourceDay: 100 };
/** Registros simultâneos: com o banco fora, erro em cascata não pode encher o pool. */
const MAX_IN_FLIGHT = 5;
/** Quem espera o registro (o worker) nunca para mais do que isto. */
const CAPTURE_TIMEOUT_MS = 2000;
const MAX_FRAMES = 8;
const UNKNOWN_ROUTE = "/desconhecida";

// Catálogo fechado: novos caminhos precisam ser incluídos aqui para aparecer nos diagnósticos.
// Valores dinâmicos e nomes de parâmetros nunca são copiados para o evento.
const KNOWN_ROUTES = [
  "/",
  "/admin",
  "/admin/agentes",
  "/admin/auditoria",
  "/admin/controles",
  "/admin/familias",
  "/admin/familias/[id]",
  "/admin/sistema",
  "/admin/usuarios",
  "/admin/usuarios/[id]",
  "/api/assistente",
  "/api/assistente/conversas",
  "/api/assistente/conversas/[id]",
  "/api/ativos",
  "/api/auth/[...all]",
  "/api/diagnostics",
  "/api/health",
  "/api/mcp/ops",
  "/api/ops/agents",
  "/api/ops/context",
  "/api/ops/deployments",
  "/api/ops/diagnostics",
  "/api/ops/memory",
  "/api/ops/reports",
  "/app",
  "/app/aposentadoria",
  "/app/calendario",
  "/app/cartoes",
  "/app/categorias",
  "/app/completar",
  "/app/configuracoes",
  "/app/contas",
  "/app/dividas",
  "/app/escolher",
  "/app/escolher/abrir",
  "/app/exportar",
  "/app/familia",
  "/app/importar",
  "/app/investimentos",
  "/app/lancamentos",
  "/app/metas",
  "/app/metas/[id]",
  "/app/novo-household",
  "/app/patrimonio",
  "/app/plano",
  "/app/proventos",
  "/app/renda",
  "/app/reserva",
  "/app/sugestoes",
  "/app/suspensa",
  "/app/viagens",
  "/app/viagens/[id]",
  "/cadastro",
  "/conta-bloqueada",
  "/convite/[id]",
  "/convite/[id]/aceitar",
  "/entrar",
  "/esqueci-senha",
  "/privacidade",
  "/redefinir-senha",
  "/termos",
];
const KNOWN_NAMES = new Set([
  "acao:admin_access_log_failed",
  "acao:admin_agent_toggle_failed",
  "acao:admin_agents_run_failed",
  "acao:admin_ai_failed",
  "acao:admin_ai_test_failed",
  "acao:admin_audit_failed",
  "acao:admin_families_failed",
  "acao:admin_family_delete_failed",
  "acao:admin_family_suspension_failed",
  "acao:admin_insights_run_failed",
  "acao:admin_maintenance_failed",
  "acao:admin_notice_failed",
  "acao:admin_notice_remove_failed",
  "acao:admin_owner_contact_failed",
  "acao:admin_password_reset_failed",
  "acao:admin_pgboss_failed",
  "acao:admin_signup_failed",
  "acao:admin_stats_run_failed",
  "acao:admin_user_block_failed",
  "acao:admin_user_delete_failed",
  "acao:admin_user_reveal_failed",
  "acao:admin_user_sessions_failed",
  "acao:admin_users_failed",
  "acao:goal_replan_failed",
  "acao:prepare_import_failed",
  "agente:aposentadoria",
  "agente:categorias",
  "agente:categorias_ia",
  "agente:fuso",
  "agente:dicas",
  "agente:investimentos",
  "agente:mercado",
  "agente:metas",
  "agente:relatorios",
  "agente:viagens",
  "job:ai-insights",
  "job:daily-agents",
  "job:market-data",
  "job:net-worth-snapshot",
  "job:ops-heartbeat",
  "job:pg-boss",
  "job:platform-stats",
]);

/** Só devolve identificadores do catálogo, nunca segmentos fornecidos por quem chama. */
export function normalizeRoute(route: string): string {
  if (KNOWN_NAMES.has(route)) return route;
  const path = route.split(/[?#]/, 1)[0]!;
  if (!path.startsWith("/")) return UNKNOWN_ROUTE;
  const segments = path.split("/").filter((part) => part && !/^\(.*\)$/.test(part));
  if (segments.at(-1) === "page" || segments.at(-1) === "route") segments.pop();
  for (const known of KNOWN_ROUTES) {
    const template = known.split("/").filter(Boolean);
    const catchAll = template.at(-1) === "[...all]";
    if (catchAll ? segments.length < template.length : segments.length !== template.length)
      continue;
    if (template.every((part, i) => part.startsWith("[") || part === segments[i])) return known;
  }
  return UNKNOWN_ROUTE;
}

const BUILT_FILE = /\.next\/server\/.+$/;
const SOURCE_FILE =
  /(?:apps\/(?:web|worker)|packages\/[a-z0-9-]+)\/.+$|(?:^|\/)(?:src\/.+|main\.js)$/;
const SAFE_FILE = /^[A-Za-z0-9_./()[\]+-]{1,300}$/;
const FRAME = /^\s*at\s+(?:.*? \()?(.+?):(\d+):(\d+)\)?\s*$/;

interface Frame {
  text: string;
  /** Arquivo-fonte, estável entre versões. Arquivo gerado muda de nome a cada build. */
  source: string | null;
}

/** Tira do texto da pilha o cabeçalho com a mensagem, que pode ter várias linhas. */
function stackLines(error: Error): string[] {
  const stack = typeof error.stack === "string" ? error.stack : "";
  const message = typeof error.message === "string" ? error.message : "";
  const at = message ? stack.indexOf(message) : -1;
  const body = at === -1 ? stack : stack.slice(at + message.length);
  return body.split("\n");
}

function ownFrames(error: unknown): Frame[] {
  if (!(error instanceof Error)) return [];
  const frames: Frame[] = [];
  for (const line of stackLines(error)) {
    const match = FRAME.exec(line);
    if (!match) continue;
    const [, rawFile, row, column] = match;
    const file = rawFile!.replace(/^file:\/+/, "").replaceAll("\\", "/");
    // `next_dist` é como o build chama os pacotes do próprio Next.
    if (/node_modules|next_dist|^node:/.test(file)) continue;
    const built = BUILT_FILE.exec(file)?.[0];
    const path = built ?? SOURCE_FILE.exec(file)?.[0]?.replace(/^\//, "");
    if (!path || !SAFE_FILE.test(path)) continue;
    // Arquivo gerado é minificado, numa linha só: sem a coluna, a linha não diz nada.
    frames.push(
      built
        ? { text: `${path}:${row}:${column}`, source: null }
        : { text: `${path}:${row}`, source: path },
    );
    if (frames.length === MAX_FRAMES) break;
  }
  return frames;
}

export function errorTypeOf(error: unknown): string {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return typeof name === "string" && /^[A-Za-z][A-Za-z0-9_$]{0,79}$/.test(name) ? name : "Error";
}

/** Primeiro código na cadeia de causas: o Drizzle guarda o do Postgres em `cause`. */
export function errorCodeOf(error: unknown): string | null {
  let current = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** Mesmo erro, mesma impressão digital, seja qual for a mensagem e a versão. */
export function diagnosticFingerprint(parts: Array<string | null>): string {
  return createHash("sha256")
    .update(parts.map((part) => part ?? "").join("|"))
    .digest("hex")
    .slice(0, 32);
}

const currentCommit = () => process.env.APP_COMMIT ?? "dev";

/** Transforma um erro no que pode ser gravado. Função pura; não toca em `error.message`. */
export function describeError(error: unknown, origin: DiagnosticOrigin): DiagnosticEvent {
  const { service, source } = origin;
  const route = normalizeRoute(origin.route);
  const errorType = errorTypeOf(error);
  const code = errorCodeOf(error);
  const frames = ownFrames(error);
  const fileOnly = frames.find((frame) => frame.source)?.source ?? null;
  return {
    fingerprint: diagnosticFingerprint([service, source, errorType, code, route, fileOnly]),
    service,
    source,
    errorType,
    route,
    commit: origin.commit ?? currentCommit(),
    code,
    stack: frames.map((frame) => frame.text),
  };
}

/** Erro visto no navegador: lá só se sabe a impressão digital enviada pela tela e a rota. */
export function describeClientError(clientFingerprint: string, route: string): DiagnosticEvent {
  // O fluxo público só identifica caminhos de telas; nomes internos não vêm do navegador.
  const clean = route.startsWith("/") ? normalizeRoute(route) : UNKNOWN_ROUTE;
  return {
    fingerprint: diagnosticFingerprint(["web", "client", clean, clientFingerprint]),
    service: "web",
    source: "client",
    errorType: "ErroDeTela",
    route: clean,
    commit: currentCommit(),
    code: null,
    stack: [],
  };
}

/**
 * Soma uma ocorrência. Linha nova só até `newPerSourceDay` por origem e por dia; a mesma impressão
 * digital soma até `perFingerprintDay` no dia, e o que passa disso não é gravado. Erro que volta
 * numa linha resolvida reabre. Devolve false quando um dos limites segurou a escrita.
 */
export async function recordDiagnostic(
  event: DiagnosticEvent,
  limits = DIAGNOSTIC_LIMITS,
): Promise<boolean> {
  const { sql: raw } = appPool();
  const { fingerprint, commit, source } = event;
  const rows = await raw`
    with today as (
      select (now() at time zone 'America/Sao_Paulo')::date as day,
        date_trunc('day', now() at time zone 'America/Sao_Paulo')
          at time zone 'America/Sao_Paulo' as started_at
    )
    insert into ops.diagnostics as d
      (fingerprint, service, source, error_type, route, commit, code, stack, day)
    select ${fingerprint}, ${event.service}, ${source}, ${event.errorType}, ${event.route},
      ${commit}, ${event.code}, ${raw.array(event.stack)}::text[], today.day
    from today
    where exists (
        select 1 from ops.diagnostics e where e.fingerprint = ${fingerprint} and e.commit = ${commit}
      )
      or (
        select count(*) from ops.diagnostics e
        where e.source = ${source} and e.first_seen_at >= today.started_at
      ) < ${limits.newPerSourceDay}
    on conflict (fingerprint, commit) do update set
      count = d.count + 1,
      day_count = case when d.day = excluded.day then d.day_count + 1 else 1 end,
      day = excluded.day,
      stack = excluded.stack,
      last_seen_at = now(),
      status = 'aberto',
      resolved_at = null
    where d.day <> excluded.day
      or d.day_count < ${limits.perFingerprintDay}
      or d.status = 'resolvido'
    returning d.id`;
  return rows.length > 0;
}

let inFlight = 0;

/** Registra sem nunca falhar nem segurar quem chamou: diagnóstico não derruba requisição nem job. */
export async function captureEvent(event: DiagnosticEvent): Promise<void> {
  if (inFlight >= MAX_IN_FLIGHT) return;
  inFlight += 1;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, CAPTURE_TIMEOUT_MS);
  });
  const write = recordDiagnostic(event)
    .then(() => undefined)
    .catch((error: unknown) => {
      // Só o código: a mensagem do banco pode repetir os valores da consulta.
      console.error(
        JSON.stringify({
          level: "error",
          msg: "diagnostic_failed",
          code: errorCodeOf(error),
        }),
      );
    })
    .finally(() => {
      inFlight -= 1;
      clearTimeout(timer);
    });
  await Promise.race([write, timeout]);
}

export async function captureError(error: unknown, origin: DiagnosticOrigin): Promise<void> {
  try {
    await captureEvent(describeError(error, origin));
  } catch {
    // Nada aqui pode virar um segundo erro.
  }
}

export interface DiagnosticFilters {
  status?: DiagnosticStatus | "todos" | undefined;
  service?: DiagnosticService | undefined;
  source?: DiagnosticSource | undefined;
  commit?: string | undefined;
  route?: string | undefined;
  fingerprint?: string | undefined;
  since?: Date | undefined;
  limit?: number | undefined;
}

/**
 * Um item por impressão digital, somando as versões em que apareceu, do mais recente ao mais antigo.
 * Por padrão, só o que está aberto. Antes da migração chegar, lista vazia.
 */
export async function listDiagnostics(filters: DiagnosticFilters = {}) {
  const t = diagnostics;
  const status = filters.status ?? "aberto";
  return tolerateSchemaLag(
    () =>
      appPool()
        .db.select({
          fingerprint: t.fingerprint,
          service: t.service,
          source: t.source,
          errorType: t.errorType,
          route: t.route,
          code: t.code,
          status: sql<DiagnosticStatus>`case when bool_or(${t.status} = 'aberto') then 'aberto' else 'resolvido' end`,
          count: sql<number>`sum(${t.count})::int`,
          firstSeenAt: min(t.firstSeenAt).mapWith(t.firstSeenAt),
          lastSeenAt: max(t.lastSeenAt).mapWith(t.lastSeenAt),
          commits: sql<string[]>`array_agg(${t.commit} order by ${t.lastSeenAt} desc)`,
          stack: sql<
            string[]
          >`(jsonb_agg(to_jsonb(${t.stack}) order by ${t.lastSeenAt} desc)) -> 0`,
        })
        .from(t)
        .where(
          and(
            status === "todos" ? undefined : eq(t.status, status),
            filters.service ? eq(t.service, filters.service) : undefined,
            filters.source ? eq(t.source, filters.source) : undefined,
            filters.commit ? eq(t.commit, filters.commit) : undefined,
            filters.route ? eq(t.route, filters.route) : undefined,
            filters.fingerprint ? eq(t.fingerprint, filters.fingerprint) : undefined,
            filters.since ? gte(t.lastSeenAt, filters.since) : undefined,
          ),
        )
        .groupBy(t.fingerprint, t.service, t.source, t.errorType, t.route, t.code)
        .orderBy(desc(max(t.lastSeenAt)))
        .limit(Math.min(Math.max(filters.limit ?? 50, 1), 100)),
    [],
  );
}

/** Marca como resolvido em todas as versões. Devolve quantas linhas mudaram. */
export async function resolveDiagnostic(fingerprint: string): Promise<number> {
  const t = diagnostics;
  const rows = await appPool()
    .db.update(t)
    .set({ status: "resolvido", resolvedAt: new Date() })
    .where(and(eq(t.fingerprint, fingerprint), eq(t.status, "aberto")))
    .returning({ id: t.id });
  return rows.length;
}

export interface DiagnosticRate {
  commit: string;
  startedAt: Date;
  occurrences: number;
  fingerprints: number;
  perHour: number;
}

/**
 * Ocorrências por hora de cada versão, da mais recente à mais antiga, no tempo em que cada uma ficou
 * no ar. É o que o SRE compara depois do merge. Conta só até o teto diário.
 */
export async function listDiagnosticRates(limit = 5): Promise<DiagnosticRate[]> {
  const size = Math.min(Math.max(limit, 2), 20);
  return tolerateSchemaLag(async () => {
    const rows = await appPool().sql<
      {
        commit: string;
        started_at: Date;
        occurrences: number;
        fingerprints: number;
        per_hour: number;
      }[]
    >`
      with versions as (
        select commit, min(started_at) as started_at
        from ops.deployments group by commit order by started_at desc limit ${size}
      ), spans as (
        select commit, started_at,
          lag(started_at) over (order by started_at desc) as replaced_at
        from versions
      )
      select s.commit, s.started_at,
        coalesce(sum(d.count), 0)::int as occurrences,
        count(d.id)::int as fingerprints,
        round(
          coalesce(sum(d.count), 0)
          / greatest(extract(epoch from coalesce(s.replaced_at, now()) - s.started_at) / 3600, 0.25),
          2
        )::float8 as per_hour
      from spans s
      left join ops.diagnostics d on d.commit = s.commit
      group by s.commit, s.started_at, s.replaced_at
      order by s.started_at desc`;
    return rows.map((row) => ({
      commit: row.commit,
      startedAt: new Date(row.started_at),
      occurrences: row.occurrences,
      fingerprints: row.fingerprints,
      perHour: row.per_hour,
    }));
  }, []);
}
