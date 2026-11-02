// Tipo da chave da Stripe (ADR-0023). Nada daqui devolve, loga ou guarda o valor: só o tipo.

export type StripeKeyMode = "ausente" | "teste" | "producao" | "invalida";

type Env = Record<string, string | undefined>;

export function stripeKeyMode(env: Env = process.env): StripeKeyMode {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) return "ausente";
  if (/^[sr]k_test_/.test(key)) return "teste";
  if (/^[sr]k_live_/.test(key)) return "producao";
  return "invalida";
}

/** Produção só com a variável do fundador, escrita assim, exatamente. */
export const liveAllowed = (env: Env = process.env) => env.STRIPE_ALLOW_LIVE === "true";

/** A chave pode ser usada agora? Chave de produção sem a variável fica recusada. */
export function stripeUsable(env: Env = process.env): boolean {
  const mode = stripeKeyMode(env);
  return mode === "teste" || (mode === "producao" && liveAllowed(env));
}

export class StripeKeyRefused extends Error {
  constructor(readonly mode: StripeKeyMode) {
    super(`Chave da Stripe recusada: ${mode}`);
  }
}
