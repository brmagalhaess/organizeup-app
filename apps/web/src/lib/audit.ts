import "server-only";
import { auditLog, type TenantContext, type TenantTx } from "@organizeup/db";

export function audit(
  tx: TenantTx,
  ctx: TenantContext,
  action: string,
  entity: string,
  entityId?: string,
) {
  return tx.insert(auditLog).values({
    householdId: ctx.householdId,
    actorUserId: ctx.userId,
    actorKind: "user",
    action,
    entity,
    entityId: entityId ?? null,
  });
}
