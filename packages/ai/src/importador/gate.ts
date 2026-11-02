// Quem libera o modelo para o importador (ADR-0030). Conferido antes de cada arquivo, com o contexto de quem
// pede ou do worker. Mensagem do assistente não é gasta: o limite aqui é de arquivos e de tokens por mês.
import {
  aiUsage,
  and,
  gte,
  householdFileConsents,
  lte,
  eq,
  readFamilyAccess,
  readPlatformFlags,
  sql,
  tolerateSchemaLag,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import {
  canUse,
  legalVersionAtLeast,
  monthBounds,
  SMART_MODEL_FILES_PER_MONTH,
  SMART_MODEL_TOKENS_PER_MONTH,
  yearMonthOf,
} from "@organizeup/domain";
import {
  aiLimits,
  canUseAssistant,
  familyTokensToday,
  monthSpend,
  readAssistantSettings,
  serviceDay,
  type AiLimits,
} from "../access";
import { assistantConfigured } from "../client";

/** Aceite que já cita qualquer arquivo, dado de terceiros e retenção. É a LEGAL_VERSION de quando o importador entrou. */
export const IMPORTER_CONSENT_VERSION = "2026-11-02.1";

export const IMPORTER_ROUTE_NAME = "importador";

export type ImporterGate =
  | "pronto"
  | "sem_chave"
  | "desligado"
  | "manutencao"
  | "somente_leitura"
  | "sem_modulo"
  | "teto_mensal"
  | "teto_diario"
  | "sem_permissao"
  | "precisa_ativar"
  | "precisa_aceitar"
  | "limite_arquivos"
  | "limite_tokens";

export interface ImporterUsage {
  files: number;
  tokens: number;
}

/** Soma do mês em `ai_usage`, que a família não apaga: cada chamada é um arquivo. */
export async function importerUsage(ctx: TenantContext, day: string): Promise<ImporterUsage> {
  const { first, last } = monthBounds(yearMonthOf(day));
  return tolerateSchemaLag(
    async () => {
      const [row] = await withHousehold(ctx, (tx) =>
        tx
          .select({
            calls: sql<string>`coalesce(sum(${aiUsage.calls}), 0)::text`,
            tokens: sql<string>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens} + ${aiUsage.cacheWriteTokens}), 0)::text`,
          })
          .from(aiUsage)
          .where(
            and(
              eq(aiUsage.route, IMPORTER_ROUTE_NAME),
              gte(aiUsage.day, first),
              lte(aiUsage.day, last),
            ),
          ),
      );
      return { files: Number(row?.calls ?? 0), tokens: Number(row?.tokens ?? 0) };
    },
    { files: 0, tokens: 0 },
  );
}

async function hasImporterConsent(ctx: TenantContext): Promise<boolean> {
  return tolerateSchemaLag(async () => {
    const [row] = await withHousehold(ctx, (tx) =>
      tx.select({ version: householdFileConsents.version }).from(householdFileConsents),
    );
    return row !== undefined && legalVersionAtLeast(row.version, IMPORTER_CONSENT_VERSION);
  }, false);
}

export interface ImporterGateInput {
  ctx: TenantContext;
  limits?: AiLimits;
  day?: string;
  env?: Record<string, string | undefined>;
}

/** `pronto` é a única saída que libera mandar arquivo ao modelo. */
export async function importerGate(input: ImporterGateInput): Promise<ImporterGate> {
  const { ctx, day = serviceDay(), limits = aiLimits(), env = process.env } = input;
  if (!assistantConfigured(env)) return "sem_chave";
  const flags = await readPlatformFlags();
  if (!flags.aiEnabled || flags.disabledAgents.includes(IMPORTER_ROUTE_NAME)) return "desligado";
  if (flags.maintenance) return "manutencao";
  const access = await readFamilyAccess(ctx, flags);
  if (access.mode === "leitura") return "somente_leitura";
  if (!canUse(access, "assistente")) return "sem_modulo";
  if ((await monthSpend(day, limits)).reached) return "teto_mensal";
  // O worker responde por quem pediu: a rota só deixa `owner` e `adult` pôr o lote na fila.
  if (ctx.role !== "system" && !canUseAssistant(ctx)) return "sem_permissao";
  const settings = await readAssistantSettings(ctx);
  if (!settings) return "desligado";
  if (!settings.consentAt) return "precisa_ativar";
  if (!(await hasImporterConsent(ctx))) return "precisa_aceitar";
  const tokens = await tolerateSchemaLag(() => familyTokensToday(ctx, day), 0);
  if (tokens >= limits.familyDailyTokens) return "teto_diario";
  const usage = await importerUsage(ctx, day);
  if (usage.files >= SMART_MODEL_FILES_PER_MONTH) return "limite_arquivos";
  return usage.tokens >= SMART_MODEL_TOKENS_PER_MONTH ? "limite_tokens" : "pronto";
}
