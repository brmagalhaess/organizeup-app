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
 * Cancelar, devolver, reenviar e mexer em desconto só com a cobrança ligada e uma chave que pode ser usada.
 * Desligada, ninguém assina de verdade e não há o que operar.
 */
export function stripeActions(billingEnabled: boolean, env: Env = process.env): StripeActions {
  if (!billingEnabled) {
    return {
      available: false,
      reason: "A cobrança está desligada: as ações da Stripe só ficam disponíveis com ela ligada.",
    };
  }
  return stripeUsable(env)
    ? { available: true, reason: null }
    : { available: false, reason: keyNotice(env).text };
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

/** O que precisa ser digitado para ligar. O servidor confere de novo. */
export const BILLING_CONFIRM = "LIGAR COBRANCA";
