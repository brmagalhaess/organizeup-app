// Teto das recusas de documento. A recusa é neutra, mas ainda é um sinal: quem tenta CPFs alheios aprende que
// aquele tem conta. O limite por IP e por conta segura um só autor; este segura vários. Passou do teto na hora,
// quem já foi recusado não chega a consultar o documento de novo, e por isso não aprende mais nada. Quem nunca foi
// recusado segue normal, então o cadastro de quem acerta não trava. Fica na memória: a web é um processo só.

import { createRateLimiter } from "./rate-limit";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_KEYS = 5000;

/** Por hora, somando todo mundo. Quem erra o próprio CPF fica bem abaixo disto. */
export const REFUSAL_CEILING = 30;

let windowEndsAt = 0;
let total = 0;
const refused = new Set<string>();

function roll(now: number) {
  if (now < windowEndsAt) return;
  windowEndsAt = now + WINDOW_MS;
  total = 0;
  refused.clear();
}

export function noteRefusal(key: string, now = Date.now()) {
  roll(now);
  total += 1;
  if (refused.size >= MAX_KEYS) refused.clear();
  refused.add(key);
  if (total === REFUSAL_CEILING) {
    console.error(JSON.stringify({ level: "error", msg: "document_refusals_ceiling" }));
  }
}

/** Esta chave (IP ou conta) já foi recusada, e o teto da hora passou? */
export function refusalsBlocked(key: string, now = Date.now()): boolean {
  roll(now);
  return total >= REFUSAL_CEILING && refused.has(key);
}

/** Para o aviso do painel. */
export function refusalCeilingReached(now = Date.now()): boolean {
  roll(now);
  return total >= REFUSAL_CEILING;
}

/** Cinco tentativas por hora por conta, somando `/app/completar` e o aceite de convite. */
const accountTries = createRateLimiter({ limit: 5, windowMs: WINDOW_MS });

export const accountKey = (userId: string) => `conta:${userId}`;

export const allowDocumentTry = (userId: string) =>
  !refusalsBlocked(accountKey(userId)) && accountTries(userId);
