// Cliente da API. A chave fica só no servidor. Este arquivo nunca entra no bundle do navegador:
// quem importa é o Route Handler.
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStream } from "@anthropic-ai/sdk/lib/BetaMessageStream";

export type StreamParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export type ModelMessage = Anthropic.Beta.Messages.BetaMessage;

/** O que o loop usa da resposta em tempo real. Nos testes, um cliente falso cumpre isto. */
export type ModelStream = Pick<BetaMessageStream, "on" | "finalMessage" | "currentMessage">;

export interface ModelClient {
  stream(params: StreamParams, options: { signal?: AbortSignal | undefined }): ModelStream;
}

const API_URL = "https://api.anthropic.com";
const TIMEOUT_MS = 120_000;

const isLoopback = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

/**
 * Endereço do modelo. Sempre a Anthropic, ignorando ANTHROPIC_BASE_URL: o dado da família não pode
 * mudar de destino por causa de uma variável de ambiente. A única exceção é o servidor falso do
 * e2e, que precisa estar fora de produção e nesta máquina.
 */
export function modelBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const fake = env.AI_TEST_BASE_URL;
  if (!fake || env.NODE_ENV === "production") return API_URL;
  try {
    const url = new URL(fake);
    return url.protocol === "http:" && isLoopback(url.hostname) ? fake : API_URL;
  } catch {
    return API_URL;
  }
}

export const assistantConfigured = (env: Record<string, string | undefined> = process.env) =>
  Boolean(env.ANTHROPIC_API_KEY);

/** Chave que não pertence a um workspace precisa dizer qual usar em toda chamada. */
export function workspaceHeaders(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim();
  return workspace ? { "anthropic-workspace-id": workspace } : {};
}

export function createModelClient(): ModelClient {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY ?? null,
    authToken: null,
    baseURL: modelBaseUrl(),
    defaultHeaders: workspaceHeaders(),
    timeout: TIMEOUT_MS,
  });
  return {
    stream: (params, options) => client.beta.messages.stream(params, options),
  };
}
