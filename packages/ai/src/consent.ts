// Ativar e desligar o assistente. Sem aceite, nenhuma chamada ao modelo (ver access.ts). Quem pode é
// conferido aqui e na tela: só responsável e adulto.
import { recordAudit } from "@organizeup/agents";
import {
  eq,
  householdSettings,
  withHousehold,
  type AiAutonomy,
  type TenantContext,
} from "@organizeup/db";
import { canUseAssistant } from "./access";

async function saveSettings(
  ctx: TenantContext,
  values: Partial<typeof householdSettings.$inferInsert>,
  audit: { action: string; metadata: Record<string, unknown> },
) {
  if (!canUseAssistant(ctx)) return false;
  await withHousehold(ctx, async (tx) => {
    await tx
      .insert(householdSettings)
      .values({ householdId: ctx.householdId, ...values })
      .onConflictDoUpdate({
        target: householdSettings.householdId,
        set: { ...values, updatedAt: new Date() },
      });
    await recordAudit(tx, ctx, audit.action, "household_settings", null, audit.metadata);
  });
  return true;
}

export const activateAssistant = (
  ctx: TenantContext,
  input: { autonomy: AiAutonomy; version: string },
) =>
  saveSettings(
    ctx,
    {
      aiConsentAt: new Date(),
      aiConsentVersion: input.version,
      aiConsentBy: ctx.userId,
      aiAutonomy: input.autonomy,
    },
    {
      action: "assistente_ativar",
      metadata: { version: input.version, autonomy: input.autonomy },
    },
  );

export const deactivateAssistant = (ctx: TenantContext) =>
  saveSettings(
    ctx,
    { aiConsentAt: null, aiConsentVersion: null, aiConsentBy: null },
    { action: "assistente_desligar", metadata: {} },
  );

export const setAssistantAutonomy = (ctx: TenantContext, autonomy: AiAutonomy) =>
  saveSettings(
    ctx,
    { aiAutonomy: autonomy },
    { action: "assistente_autonomia", metadata: { autonomy } },
  );

export async function consentRecord(ctx: TenantContext) {
  const [row] = await withHousehold(ctx, (tx) =>
    tx
      .select({ at: householdSettings.aiConsentAt, version: householdSettings.aiConsentVersion })
      .from(householdSettings)
      .where(eq(householdSettings.householdId, ctx.householdId)),
  );
  return row ?? null;
}
