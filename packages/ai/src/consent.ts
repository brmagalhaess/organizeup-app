// Ativar e desligar o assistente. Sem aceite, nenhuma chamada ao modelo (ver access.ts). Quem pode é
// conferido aqui e na tela: só responsável e adulto.
import { recordAudit } from "@organizeup/agents";
import {
  eq,
  householdFileConsents,
  householdSettings,
  tolerateSchemaLag,
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

/** Aceite de mandar arquivos inteiros ao serviço de IA, além do aceite do assistente (ADR-0019). */
export async function acceptDebtFiles(ctx: TenantContext, version: string): Promise<boolean> {
  if (!canUseAssistant(ctx)) return false;
  await withHousehold(ctx, async (tx) => {
    await tx
      .insert(householdFileConsents)
      .values({ householdId: ctx.householdId, version, acceptedBy: ctx.userId })
      .onConflictDoUpdate({
        target: householdFileConsents.householdId,
        set: { version, acceptedBy: ctx.userId, acceptedAt: new Date() },
      });
    await recordAudit(tx, ctx, "arquivos_aceitar", "household_file_consents", null, { version });
  });
  return true;
}

const revokeDebtFiles = (ctx: TenantContext) =>
  tolerateSchemaLag(
    () => withHousehold(ctx, (tx) => tx.delete(householdFileConsents).returning()),
    [],
  );

/** Desligar o assistente retira também o aceite de arquivos: nada mais vai ao modelo. */
export async function deactivateAssistant(ctx: TenantContext) {
  const done = await saveSettings(
    ctx,
    { aiConsentAt: null, aiConsentVersion: null, aiConsentBy: null },
    { action: "assistente_desligar", metadata: {} },
  );
  if (done) await revokeDebtFiles(ctx);
  return done;
}

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
