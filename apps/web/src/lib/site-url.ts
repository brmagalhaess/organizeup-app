const FALLBACK = "http://localhost:3000";

/**
 * Endereço do site para `metadataBase` e textos que precisam de URL absoluta. `BETTER_AUTH_URL` vazio
 * ou malformado nunca derruba a tela: cai no padrão local, como o resto das leituras de ambiente.
 */
export function siteUrl(): URL {
  try {
    return new URL(process.env.BETTER_AUTH_URL || FALLBACK);
  } catch {
    return new URL(FALLBACK);
  }
}
