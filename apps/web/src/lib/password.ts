// Regra de senha, usada nos formulários e conferida de novo no servidor (lib/auth.ts).
export const PASSWORD_HINT = "Use letras, números e um caractere especial, como ! ou @.";
export const PASSWORD_ERROR = "A senha precisa ter letras, números e um caractere especial.";

/** Letra, número e caractere especial. Espaço não conta como especial. */
export const isValidPassword = (password: string) =>
  /\p{L}/u.test(password) && /\p{N}/u.test(password) && /[^\p{L}\p{N}\s]/u.test(password);
