// Portão do serviço: conta bloqueada, família suspensa e chaves do sistema (ADR-0016). Roda a cada
// requisição do app, então tudo aqui tolera a migração ainda não aplicada: a coluna ou a tabela nova
// faltando vale como "liberado", e a web sobe antes do worker sem derrubar nada.
import { eq, sql } from "drizzle-orm";
import { appPool } from "./client";
import { featureFlags, householdAccess, userAccess } from "./schema";

/** 42703 (coluna) e 42P01 (tabela): a versão nova subiu antes da migração. */
export function isSchemaLag(error: unknown): boolean {
  for (
    let current: unknown = error;
    typeof current === "object" && current !== null;
    current = (current as { cause?: unknown }).cause
  ) {
    const code = (current as { code?: unknown }).code;
    if (code === "42703" || code === "42P01") return true;
  }
  return false;
}

/**
 * Roda uma leitura em transação própria e cai em `fallback` enquanto a migração não chegou. A leitura
 * precisa ser separada: um erro de SQL aborta a transação inteira.
 */
export async function tolerateSchemaLag<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isSchemaLag(error)) return fallback;
    throw error;
  }
}

export async function userIsBlocked(userId: string): Promise<boolean> {
  return tolerateSchemaLag(async () => {
    const [row] = await appPool()
      .db.select({ blockedAt: userAccess.blockedAt })
      .from(userAccess)
      .where(eq(userAccess.id, userId));
    return Boolean(row?.blockedAt);
  }, false);
}

export async function householdIsSuspended(householdId: string): Promise<boolean> {
  return tolerateSchemaLag(async () => {
    const [row] = await appPool()
      .db.select({ suspendedAt: householdAccess.suspendedAt })
      .from(householdAccess)
      .where(eq(householdAccess.id, householdId));
    return Boolean(row?.suspendedAt);
  }, false);
}

/** Famílias suspensas entre os ids informados, para a tela de escolha. */
export async function suspendedHouseholdIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  return tolerateSchemaLag(async () => {
    const rows = await appPool()
      .db.select({ id: householdAccess.id })
      .from(householdAccess)
      .where(sql`${householdAccess.id} in ${ids} and ${householdAccess.suspendedAt} is not null`);
    return new Set(rows.map((row) => row.id));
  }, new Set<string>());
}

export const FLAG_KEYS = {
  maintenance: "manutencao",
  signupClosed: "cadastro_fechado",
  /** Assistente com IA. Linha ausente: ligado. `enabled = false`: desligado pelo painel. */
  ai: "ai",
  agentOff: (agent: string) => `agente_desligado:${agent}`,
  notice: (id: string) => `aviso:${id}`,
} as const;

const AGENT_PREFIX = FLAG_KEYS.agentOff("");
const NOTICE_PREFIX = FLAG_KEYS.notice("");

export interface PlatformNotice {
  id: string;
  text: string;
  /** ISO. Null: já vale desde a criação. */
  startsAt: string | null;
  /** ISO. Null: fica até ser removido. */
  endsAt: string | null;
}

export interface PlatformFlags {
  maintenance: boolean;
  maintenanceMessage: string | null;
  signupClosed: boolean;
  aiEnabled: boolean;
  disabledAgents: string[];
  notices: PlatformNotice[];
}

export const NO_FLAGS: PlatformFlags = {
  maintenance: false,
  maintenanceMessage: null,
  signupClosed: false,
  aiEnabled: true,
  disabledAgents: [],
  notices: [],
};

interface FlagRow {
  key: string;
  enabled: boolean;
  value: Record<string, unknown>;
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

export function parsePlatformFlags(rows: FlagRow[]): PlatformFlags {
  const flags: PlatformFlags = { ...NO_FLAGS, disabledAgents: [], notices: [] };
  for (const { key, enabled, value } of rows) {
    if (key === FLAG_KEYS.maintenance) {
      flags.maintenance = enabled;
      flags.maintenanceMessage = enabled ? text(value.message) : null;
    } else if (key === FLAG_KEYS.signupClosed) {
      flags.signupClosed = enabled;
    } else if (key === FLAG_KEYS.ai) {
      flags.aiEnabled = enabled;
    } else if (key.startsWith(AGENT_PREFIX) && enabled) {
      flags.disabledAgents.push(key.slice(AGENT_PREFIX.length));
    } else if (key.startsWith(NOTICE_PREFIX) && enabled && text(value.text)) {
      flags.notices.push({
        id: key.slice(NOTICE_PREFIX.length),
        text: text(value.text)!,
        startsAt: text(value.startsAt),
        endsAt: text(value.endsAt),
      });
    }
  }
  return flags;
}

/** Lê as chaves do sistema. Sem a tabela ainda, vale o padrão: tudo desligado. */
export async function readPlatformFlags(): Promise<PlatformFlags> {
  return tolerateSchemaLag(
    async () => parsePlatformFlags(await appPool().db.select().from(featureFlags)),
    NO_FLAGS,
  );
}

/** Avisos valendo agora, na ordem em que começaram. */
export function activeNotices(flags: PlatformFlags, now = new Date()): PlatformNotice[] {
  const time = now.getTime();
  return flags.notices
    .filter(
      (notice) =>
        (!notice.startsAt || new Date(notice.startsAt).getTime() <= time) &&
        (!notice.endsAt || new Date(notice.endsAt).getTime() > time),
    )
    .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));
}
