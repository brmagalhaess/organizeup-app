// Portão do serviço: conta bloqueada, família suspensa e chaves do sistema (ADR-0016). Roda a cada
// requisição do app, então tudo aqui tolera a migração ainda não aplicada: a coluna ou a tabela nova
// faltando vale como "liberado", e a web sobe antes do worker sem derrubar nada.
import { createHash } from "node:crypto";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { AccountType } from "@organizeup/domain";
import { appPool } from "./client";
import {
  featureFlags,
  householdAccess,
  householdInvitation,
  userAccess,
  userPreferences,
  verification,
} from "./schema";

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

/** Idioma guardado na conta. Sem escolha, ou sem a tabela ainda, devolve null. */
export async function readUserLocale(userId: string): Promise<string | null> {
  return tolerateSchemaLag(async () => {
    const [row] = await appPool()
      .db.select({ locale: userPreferences.locale })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    return row?.locale ?? null;
  }, null);
}

/** Grava o idioma na conta. Devolve false enquanto a tabela não chegou: aí só o cookie vale. */
export async function saveUserLocale(userId: string, locale: string): Promise<boolean> {
  return tolerateSchemaLag(async () => {
    await appPool()
      .db.insert(userPreferences)
      .values({ userId, locale })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { locale, updatedAt: new Date() },
      });
    return true;
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

/** Tipo da conta. Lido antes de a pessoa entrar, no convite e no e-mail. Sem a coluna ainda: 'pf'. */
export async function householdAccountType(householdId: string): Promise<AccountType> {
  return tolerateSchemaLag(async () => {
    const [row] = await appPool()
      .db.select({ accountType: householdAccess.accountType })
      .from(householdAccess)
      .where(eq(householdAccess.id, householdId));
    return row?.accountType ?? "pf";
  }, "pf");
}

/** Tipo da família do convite. Convite inexistente vale como 'pf': a tela já o recusa adiante. */
export async function inviteAccountType(invitationId: string): Promise<AccountType> {
  return tolerateSchemaLag(async () => {
    const [row] = await appPool()
      .db.select({ accountType: householdAccess.accountType })
      .from(householdInvitation)
      .innerJoin(householdAccess, eq(householdAccess.id, householdInvitation.organizationId))
      .where(eq(householdInvitation.id, invitationId));
    return row?.accountType ?? "pf";
  }, "pf");
}

/** Só sobe para 'pj': quem é responsável e informou empresa. Nunca volta sozinho para 'pf'. */
export async function markHouseholdAsCompany(householdId: string): Promise<void> {
  await appPool()
    .db.update(householdAccess)
    .set({ accountType: "pj" })
    .where(eq(householdAccess.id, householdId));
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
  /** Cobrança. Desligada: todos têm acesso como hoje, e a tela de planos só aparece para admin. */
  billing: "billing_enabled",
  /** Importador inteligente. Desligado, só o admin do serviço usa (ADR-0030). */
  smartImport: "smart_import_enabled",
  /** Conexão com bancos pela Pluggy. Desligada, só o admin do serviço usa (ADR-0038). */
  bankFeed: "bank_feed_enabled",
  agentOff: (agent: string) => `agente_desligado:${agent}`,
  notice: (id: string) => `aviso:${id}`,
} as const;

const AGENT_PREFIX = FLAG_KEYS.agentOff("");
const NOTICE_PREFIX = FLAG_KEYS.notice("");

/**
 * Nome que o CHECK de `ops.agent_runs` recusava. Quem desligou o agente antes da troca continua com ele
 * desligado, sem migração; o painel grava a chave nova, que vence a antiga.
 */
const RENAMED_AGENTS: Record<string, string> = { categorias_ia: "categorias-ia" };

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
  billingEnabled: boolean;
  smartImportEnabled: boolean;
  bankFeedEnabled: boolean;
  disabledAgents: string[];
  notices: PlatformNotice[];
}

export const NO_FLAGS: PlatformFlags = {
  maintenance: false,
  maintenanceMessage: null,
  signupClosed: false,
  aiEnabled: true,
  billingEnabled: false,
  smartImportEnabled: false,
  bankFeedEnabled: false,
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
    } else if (key === FLAG_KEYS.billing) {
      flags.billingEnabled = enabled;
    } else if (key === FLAG_KEYS.smartImport) {
      flags.smartImportEnabled = enabled;
    } else if (key === FLAG_KEYS.bankFeed) {
      flags.bankFeedEnabled = enabled;
    } else if (key.startsWith(AGENT_PREFIX) && enabled) {
      const agent = key.slice(AGENT_PREFIX.length);
      const renamed = RENAMED_AGENTS[agent];
      if (!renamed) flags.disabledAgents.push(agent);
      else if (!rows.some((row) => row.key === FLAG_KEYS.agentOff(renamed))) {
        flags.disabledAgents.push(renamed);
      }
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

const CONFIRMATION_LIMITS = [
  { max: 1, windowMs: 60 * 1000 },
  { max: 5, windowMs: 60 * 60 * 1000 },
];
const CONFIRMATION_KEEP_MS = 60 * 60 * 1000;

export type ConfirmationSlot = { id: string } | { retryAfterSeconds: number };

/** `sentAt` do mais novo para o mais velho. Zero quando há vaga nas duas janelas. */
function confirmationWait(sentAt: number[], now: number) {
  const waits = CONFIRMATION_LIMITS.map(({ max, windowMs }) => {
    const oldestCounted = sentAt[max - 1];
    return oldestCounted === undefined ? 0 : oldestCounted + windowMs - now;
  });
  return Math.max(0, Math.ceil(Math.max(...waits) / 1000));
}

/** Só o hash: a linha fica até uma hora depois de a conta ser apagada, e nela não sobra o endereço. */
const confirmationKey = (email: string) =>
  `confirmar-email:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;

/**
 * Vaga para enviar a confirmação de e-mail: 1 por minuto e 5 por hora, por endereço, somando cadastro,
 * reenvio e admin. Por endereço, e não por conta: apagar a conta e cadastrar de novo não zera a conta. Guarda
 * cada envio em `verification`, a tabela do Better Auth que apaga as linhas vencidas, para valer entre
 * instâncias e depois de um reinício sem migração. A trava impede dois pedidos de contarem a mesma vaga.
 */
export async function reserveConfirmationEmail(
  email: string,
  now = new Date(),
): Promise<ConfirmationSlot> {
  const identifier = confirmationKey(email);
  return appPool().db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identifier}, 0))`);
    await tx
      .delete(verification)
      .where(and(eq(verification.identifier, identifier), lte(verification.expiresAt, now)));
    const sent = await tx
      .select({ at: verification.createdAt })
      .from(verification)
      .where(eq(verification.identifier, identifier))
      .orderBy(desc(verification.createdAt));
    const retryAfterSeconds = confirmationWait(
      sent.map((row) => row.at.getTime()),
      now.getTime(),
    );
    if (retryAfterSeconds > 0) return { retryAfterSeconds };
    const id = crypto.randomUUID();
    await tx.insert(verification).values({
      id,
      identifier,
      value: "enviado",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + CONFIRMATION_KEEP_MS),
    });
    return { id };
  });
}

/** O envio falhou: a vaga volta, porque nada chegou à pessoa. */
export async function releaseConfirmationEmail(id: string): Promise<void> {
  await appPool().db.delete(verification).where(eq(verification.id, id));
}
