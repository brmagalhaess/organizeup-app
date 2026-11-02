// Quem pode mexer na assinatura, e quando. Vem antes de qualquer chamada à Stripe. Usa o papel real da
// pessoa: em só leitura o contexto vira `viewer`, e o responsável ainda precisa conseguir assinar.
import "server-only";
import {
  fromSession,
  householdIsSuspended,
  readSubscription,
  type HouseholdSubscription,
  type TenantContext,
} from "@organizeup/db";
import { refundWindowOpen, stripeAlive } from "@organizeup/domain";
import { isServiceAdmin, platformFlags, requireSession } from "@/lib/session";
import { stripeKeyMode, stripeUsable } from "./stripe-key";

export type BillingRefusal =
  | "sem_familia"
  | "so_responsavel"
  | "manutencao"
  /** A chave `billing_enabled` está desligada, e quem pediu não é admin testando com chave de teste. */
  | "desligado"
  | "sem_chave"
  /** Chave de produção sem `STRIPE_ALLOW_LIVE=true`. */
  | "chave_producao";

export type BillingActor =
  | { ok: true; ctx: TenantContext; subscription: HouseholdSubscription | null }
  | { ok: false; code: BillingRefusal };

/**
 * Quem já paga sempre consegue sair: cancelar e devolver não dependem de `billing_enabled`. A assinatura segue
 * na Stripe mesmo com a chave desligada, e a devolução que caiu no meio pode já ter encerrado a assinatura.
 */
export function canLeave(
  subscription: Pick<
    HouseholdSubscription,
    "stripeSubscriptionId" | "status" | "firstPaidAt" | "refundedAt"
  > | null,
  now: Date,
): boolean {
  if (!subscription?.stripeSubscriptionId) return false;
  return stripeAlive(subscription.status) || refundWindowOpen({ ...subscription, now });
}

/**
 * `exit`: o pedido é para sair, e não para começar a pagar. Assinar e trocar de plano continuam exigindo a
 * chave ligada.
 */
export async function billingActor(
  env: Record<string, string | undefined> = process.env,
  { exit = false }: { exit?: boolean } = {},
): Promise<BillingActor> {
  const session = await requireSession();
  const ctx = await fromSession(session);
  if (!ctx || (await householdIsSuspended(ctx.householdId))) {
    return { ok: false, code: "sem_familia" };
  }
  if (ctx.role !== "owner") return { ok: false, code: "so_responsavel" };
  const flags = await platformFlags();
  if (flags.maintenance) return { ok: false, code: "manutencao" };

  const mode = stripeKeyMode(env);
  const subscription = await readSubscription(ctx);
  // Chave desligada: só o admin, e só em modo de teste. Nenhuma cobrança real antes da liberação.
  if (
    !flags.billingEnabled &&
    !(mode === "teste" && isServiceAdmin(session.user)) &&
    !(exit && canLeave(subscription, new Date()))
  ) {
    return { ok: false, code: mode === "producao" ? "chave_producao" : "desligado" };
  }
  if (!stripeUsable(env)) {
    return { ok: false, code: mode === "producao" ? "chave_producao" : "sem_chave" };
  }
  return { ok: true, ctx, subscription };
}
