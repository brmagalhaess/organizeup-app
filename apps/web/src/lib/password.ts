// Regra de senha, usada nos formulários e conferida de novo no servidor (lib/auth.ts).
// Os textos ficam em messages/ (auth.fields.passwordHint e auth.errors.passwordRule).

/** Letra, número e caractere especial. Espaço não conta como especial. */
export const isValidPassword = (password: string) =>
  /\p{L}/u.test(password) && /\p{N}/u.test(password) && /[^\p{L}\p{N}\s]/u.test(password);
