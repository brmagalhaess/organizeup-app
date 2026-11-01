// Quem pode falar com o modelo, e quando (§0 e §1). Tudo é conferido no servidor, antes de cada
// chamada. O teto mensal não depende de ninguém gravar nada: sai da soma de ops.ai_stats, então
// desliga sozinho ao bater, volta no mês seguinte e só o painel escreve em ops.feature_flags.
import {
  aiMonthTotals,
  aiUsage,
  and,
  eq,
  householdSettings,
  readPlatformFlags,
  sql,
  tolerateSchemaLag,
  userPreferences,
  withHousehold,
  type AiAutonomy,
  type PlatformFlags,
  type TenantContext,
} from "@organizeup/db";
import { todayIn, yearMonthOf } from "@organizeup/domain";
import { assistantConfigured } from "./client";
import { isAssistantLocale, type AssistantLocale } from "./instructions";

export const DEFAULT_MONTHLY_BUDGET_USD = 50;
export const DEFAULT_FAMILY_DAILY_TOKENS = 200_000;

export interface AiLimits {
  monthlyBudgetUsd: number;
  familyDailyTokens: number;
}

const limit = (raw: string | undefined, fallback: number) => {
  const value = Number(raw);
  return raw?.trim() && Number.isFinite(value) && value >= 0 ? value : fallback;
};

export const aiLimits = (env: Record<string, string | undefined> = process.env): AiLimits => ({
  monthlyBudgetUsd: limit(env.AI_MONTHLY_BUDGET_USD, DEFAULT_MONTHLY_BUDGET_USD),
  familyDailyTokens: limit(env.AI_FAMILY_DAILY_TOKENS, DEFAULT_FAMILY_DAILY_TOKENS),
});

/** Dia de contagem do serviço (Brasília): o teto é um só, para todas as famílias. */
export const serviceDay = (now: Date = new Date()) => todayIn(undefined, now);

/** Gasto do mês no serviço inteiro, contra o teto. */
export async function monthSpend(day: string = serviceDay(), limits: AiLimits = aiLimits()) {
  const totals = await aiMonthTotals(yearMonthOf(day));
  const spent = Number(totals.costUsd);
  return {
    ...totals,
    spentUsd: spent,
    budgetUsd: limits.monthlyBudgetUsd,
    reached: spent >= limits.monthlyBudgetUsd,
  };
}

/** Tokens que a família gastou no dia. Leitura de cache fica fora: custa um vigésimo. */
async function familyTokensToday(ctx: TenantContext, day: string): Promise<number> {
  const [row] = await withHousehold(ctx, (tx) =>
    tx
      .select({
        total: sql<string>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens} + ${aiUsage.cacheWriteTokens}), 0)::text`,
      })
      .from(aiUsage)
      .where(and(eq(aiUsage.householdId, ctx.householdId), eq(aiUsage.day, day))),
  );
  return Number(row?.total ?? 0);
}

export type AssistantState =
  | "pronto"
  /** Falta ANTHROPIC_API_KEY. */
  | "sem_chave"
  /** Chave `ai` desligada no painel, ou a migração ainda não chegou. */
  | "desligado"
  | "manutencao"
  | "teto_mensal"
  | "teto_diario"
  /** Só `owner` e `adult` conversam e ativam. */
  | "sem_permissao"
  | "precisa_ativar";

export interface AssistantSettings {
  consentAt: Date | null;
  consentVersion: string | null;
  autonomy: AiAutonomy;
}

const NO_SETTINGS: AssistantSettings = {
  consentAt: null,
  consentVersion: null,
  autonomy: "organizar",
};

/** Null: a coluna ainda não existe (a web subiu antes do worker). */
export async function readAssistantSettings(ctx: TenantContext): Promise<AssistantSettings | null> {
  return tolerateSchemaLag(async () => {
    const [row] = await withHousehold(ctx, (tx) =>
      tx
        .select({
          consentAt: householdSettings.aiConsentAt,
          consentVersion: householdSettings.aiConsentVersion,
          autonomy: householdSettings.aiAutonomy,
        })
        .from(householdSettings)
        .where(eq(householdSettings.householdId, ctx.householdId)),
    );
    return row ?? NO_SETTINGS;
  }, null);
}

/**
 * Idioma de quem definiu o aceite, que responde pelo que a rotina da noite escreve (ADR-0020). Sem
 * preferência, ou sem quem aceitou, vale o português.
 */
export async function nightLocale(ctx: TenantContext): Promise<AssistantLocale> {
  return tolerateSchemaLag(async () => {
    const [row] = await withHousehold(ctx, (tx) =>
      tx
        .select({ locale: userPreferences.locale })
        .from(householdSettings)
        .innerJoin(userPreferences, eq(userPreferences.userId, householdSettings.aiConsentBy))
        .where(eq(householdSettings.householdId, ctx.householdId)),
    );
    return isAssistantLocale(row?.locale) ? row.locale : "pt-BR";
  }, "pt-BR");
}

export const canUseAssistant = (ctx: TenantContext) => ctx.role === "owner" || ctx.role === "adult";

export interface AccessInput {
  ctx: TenantContext;
  flags?: PlatformFlags;
  limits?: AiLimits;
  day?: string;
  env?: Record<string, string | undefined>;
}

/** Estado do assistente para esta pessoa. `pronto` é a única saída que libera o modelo. */
export async function assistantState(input: AccessInput): Promise<AssistantState> {
  const { ctx, day = serviceDay(), limits = aiLimits(), env = process.env } = input;
  if (!assistantConfigured(env)) return "sem_chave";
  const flags = input.flags ?? (await readPlatformFlags());
  if (!flags.aiEnabled) return "desligado";
  if (flags.maintenance) return "manutencao";
  if ((await monthSpend(day, limits)).reached) return "teto_mensal";
  if (!canUseAssistant(ctx)) return "sem_permissao";
  const settings = await readAssistantSettings(ctx);
  if (!settings) return "desligado";
  if (!settings.consentAt) return "precisa_ativar";
  const tokens = await tolerateSchemaLag(() => familyTokensToday(ctx, day), 0);
  return tokens >= limits.familyDailyTokens ? "teto_diario" : "pronto";
}
