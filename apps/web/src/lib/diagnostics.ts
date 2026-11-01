import { captureError } from "@organizeup/db";

/**
 * Falha que a server action trata e transforma em mensagem: sem isto a equipe não veria, porque o
 * erro não chega ao `onRequestError`. `name` é fixo no código, como o `msg` do log. Não espera o
 * registro e não falha.
 */
export function reportActionFailure(name: string, error: unknown): void {
  void captureError(error, { service: "web", source: "action", route: `acao:${name}` });
}
