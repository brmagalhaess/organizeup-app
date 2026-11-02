// O que a chave da cobrança e a chave da Stripe permitem no painel. Puro: recebe o ambiente, nunca devolve o
// valor da chave, só o tipo.
import {
  liveAllowed,
  stripeKeyMode,
  stripeUsable,
  type StripeKeyMode,
} from "@/lib/billing/stripe-key";

type Env = Record<string, string | undefined>;

export interface StripeActions {
  available: boolean;
  /** Por que os botões estão desligados. Null: disponíveis. */
  reason: string | null;
}

/**
 * Cancelar e devolver não dependem de `billing_enabled`: quem já paga sempre consegue sair. Só precisam de uma
 * chave que possa ser usada.
 */
export function stripeExitActions(env: Env = process.env): StripeActions {
  return stripeUsable(env)
    ? { available: true, reason: null }
    : { available: false, reason: keyNotice(env).text };
}

/** Reenviar cobrança e mexer em desconto mexem em quanto se paga: só com a cobrança ligada. */
export function stripeActions(billingEnabled: boolean, env: Env = process.env): StripeActions {
  if (!billingEnabled) {
    return {
      available: false,
      reason: "A cobrança está desligada: reenviar e mexer em desconto só com ela ligada.",
    };
  }
  return stripeExitActions(env);
}

export interface KeyNotice {
  mode: StripeKeyMode;
  label: string;
  tone: "neutral" | "success" | "warning" | "danger";
  text: string;
  /** Com esta chave, ligar a cobrança cobra de verdade. */
  real: boolean;
}

export function keyNotice(env: Env = process.env): KeyNotice {
  const mode = stripeKeyMode(env);
  if (mode === "teste") {
    return {
      mode,
      label: "Teste",
      tone: "success",
      text: "Chave de teste: nenhum cartão é cobrado de verdade.",
      real: false,
    };
  }
  if (mode === "producao") {
    return liveAllowed(env)
      ? {
          mode,
          label: "Produção",
          tone: "danger",
          text: "Chave de produção: cobrança real. Com a cobrança ligada, cartões de verdade são cobrados.",
          real: true,
        }
      : {
          mode,
          label: "Produção recusada",
          tone: "danger",
          text: "Chave de produção sem STRIPE_ALLOW_LIVE=true: o sistema recusa usar. Só o fundador define essa variável.",
          real: true,
        };
  }
  if (mode === "invalida") {
    return {
      mode,
      label: "Inválida",
      tone: "danger",
      text: "STRIPE_SECRET_KEY não parece uma chave da Stripe.",
      real: false,
    };
  }
  return {
    mode,
    label: "Sem chave",
    tone: "warning",
    text: "Falta STRIPE_SECRET_KEY no serviço web.",
    real: false,
  };
}

export const webhookConfigured = (env: Env = process.env) =>
  Boolean(env.STRIPE_WEBHOOK_SECRET?.trim());

/** Por que a cobrança não pode ser ligada. Null: pode. Sem webhook, quem paga não receberia o plano. */
export function enableRefusal(env: Env = process.env): string | null {
  if (!stripeUsable(env)) return keyNotice(env).text;
  return webhookConfigured(env)
    ? null
    : "Falta STRIPE_WEBHOOK_SECRET: sem o webhook, quem pagar não recebe o plano.";
}

/** O que precisa ser digitado para ligar. O servidor confere de novo. */
export const BILLING_CONFIRM = "LIGAR COBRANCA";
/** Para desligar com assinatura de pé: o servidor confere de novo. */
export const BILLING_OFF_CONFIRM = "DESLIGAR COBRANCA";
