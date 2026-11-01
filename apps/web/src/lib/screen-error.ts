// Erro que só o navegador vê. Sai daqui uma impressão digital e a rota sem parâmetros: nem mensagem,
// nem query string, nem valor de parâmetro. Quem tem `digest` já foi registrado pelo servidor.

type Params = Record<string, string | string[] | undefined>;

/** Troca o valor de cada parâmetro da rota pelo nome dele: `/app/metas/abc` → `/app/metas/[id]`. */
export function screenRoute(pathname: string, params: Params): string {
  const names = new Map<string, string>();
  for (const [name, value] of Object.entries(params)) {
    for (const part of [value].flat()) {
      if (part) names.set(encodeURIComponent(part), `[${name}]`);
    }
  }
  return pathname
    .split("/")
    .map((part) => names.get(part) ?? part)
    .join("/");
}

/**
 * Só o tipo do erro: mensagem pode ter dado pessoal, e o arquivo do pacote muda de nome a cada
 * build. Junto com a rota, é o que identifica o erro de uma versão para outra.
 */
async function fingerprintOf(error: Error): Promise<string> {
  const bytes = new TextEncoder().encode(error.name);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Melhor esforço: a tela de erro não pode falhar por causa do aviso. */
export async function sendScreenError(error: Error, route: string): Promise<void> {
  try {
    const fingerprint = await fingerprintOf(error);
    await fetch("/api/diagnostics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint, route }),
      keepalive: true,
    });
  } catch {
    // Sem rede ou sem crypto.subtle: fica sem aviso.
  }
}
