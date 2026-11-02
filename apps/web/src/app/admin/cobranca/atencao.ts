// O que pede atenção do painel na cobrança, família por família. Puro: recebe o que `resolveAccess` decidiu, e
// a regra de quem a Stripe cobra é `willChargeAgain`.
import type { AdminFamilyBilling } from "@organizeup/db";
import { willChargeAgain, type FamilyAccess } from "@organizeup/domain";

export interface FamilyState {
  family: AdminFamilyBilling;
  access: FamilyAccess;
}

export interface BillingAttention {
  /** Cortesia ou VIP sem custo, e a Stripe segue cobrando. */
  charged: FamilyState[];
  /** VIP com desconto valendo, e a Stripe ainda cobra outro valor. */
  unapplied: FamilyState[];
  /** A Stripe segue dando desconto sem VIP valendo. */
  leftover: FamilyState[];
}

const charging = ({ family }: FamilyState) => {
  const sub = family.subscription;
  return sub !== null && sub.hasSubscription && willChargeAgain(sub);
};

export function billingAttention(states: readonly FamilyState[]): BillingAttention {
  return {
    // Em teste na Stripe nada é cobrado: é quem assinou durante o VIP, para começar quando ele acabar.
    charged: states.filter(
      (state) =>
        (state.access.mode === "cortesia" || state.access.mode === "vip") &&
        charging(state) &&
        state.family.subscription?.status !== "trialing",
    ),
    unapplied: states.filter(
      (state) =>
        state.access.vip?.cost === "desconto" &&
        charging(state) &&
        state.family.subscription?.discountPercent !== state.access.vip.discountPercent,
    ),
    leftover: states.filter(
      (state) => charging(state) && state.family.subscription?.discountPercent && !state.access.vip,
    ),
  };
}

/** Quantas assinaturas seguem cobrando na Stripe, mesmo com a chave desligada. */
export const liveSubscriptions = (states: readonly FamilyState[]) => states.filter(charging).length;
