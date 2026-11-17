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

/**
 * Build novo no ar e página aberta de antes dele: a ação de servidor que a página chama não existe
 * mais no servidor. Em geral não é defeito da tela, e "tentar de novo" falha igual, porque o
 * JavaScript carregado continua sendo o velho — recarregar resolve. O nome é o que o Next.js põe em
 * `error.name` (`UnrecognizedActionError`); é também o que a impressão digital do navegador usa.
 *
 * Só serve para escolher a saída que a tela oferece. **Não serve para calar o aviso**: o mesmo nome
 * aparece quando o despacho da ação quebra no servidor de verdade — um proxy que corta cabeçalho,
 * um build publicado pela metade, instâncias em versões diferentes —, e aí recarregar não resolve e
 * o registro é a única chance de a equipe perceber (ORG-279, revisão de ORG-284).
 */
export const isStaleBuild = (error: { name?: string }) => error.name === "UnrecognizedActionError";

/** Como a tela de erro oferece a saída: `reset()` do Next, ou recarregar para pegar o build novo. */
export type ScreenRecovery = "tentar" | "recarregar";

export const screenRecovery = (error: { name?: string }): ScreenRecovery =>
  isStaleBuild(error) ? "recarregar" : "tentar";

/**
 * O que vale avisar à equipe: só quem tem `digest` fica fora, porque o servidor já registrou.
 *
 * Build velho **continua sendo avisado**, de propósito. O painel agrupa por impressão digital, então
 * ele ocupa uma linha por rota, não uma por ocorrência, e não encobre nada; em troca, é o único
 * sinal de uma pane de verdade no despacho de ações. Calar erro é decisão do fundador, não nossa.
 */
export const worthReporting = (error: { name?: string; digest?: string }) => !error.digest;

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
