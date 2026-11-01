// Erros da API do modelo. A mensagem da API nunca vai para log nem para ops: dela só sai um motivo
// fixo, ou o caminho do campo recusado, para a equipe saber a causa sem texto da família.
import Anthropic, { type APIError } from "@anthropic-ai/sdk";
import { captureError } from "@organizeup/db";

export type AssistantErrorCode =
  "sem_conversa" | "limite_de_uso" | "indisponivel" | "muito_longa" | "chave_invalida" | "falha";

const FIELD_PATH = /^[a-z_]+(?:\.[a-z0-9_]+)*(?=:)/i;
const MAX_CODE = 40;

export function apiMessage(error: APIError): string {
  const message = (error.error as { error?: { message?: unknown } } | undefined)?.error?.message;
  return typeof message === "string" ? message : "";
}

/** A API não dá tipo próprio a estes 400: crédito, workspace e beta só aparecem no texto. */
export function apiReason(error: APIError): string {
  const message = apiMessage(error);
  if (error.status === 402 || /credit balance/i.test(message)) return "sem-credito";
  if (/workspace/i.test(message)) return "sem-workspace";
  if (/anthropic-beta/i.test(message)) return "beta-recusado";
  if (/too long|too large/i.test(message)) return "longa-demais";
  return FIELD_PATH.exec(message)?.[0] ?? "outro";
}

export function errorCode(error: unknown): AssistantErrorCode {
  if (error instanceof Anthropic.RateLimitError) return "limite_de_uso";
  if (error instanceof Anthropic.AuthenticationError) return "chave_invalida";
  if (error instanceof Anthropic.PermissionDeniedError) return "chave_invalida";
  if (error instanceof Anthropic.APIConnectionError) return "indisponivel";
  if (error instanceof Anthropic.InternalServerError) return "indisponivel";
  if (error instanceof Anthropic.APIError) {
    const reason = apiReason(error);
    if (reason === "sem-credito" || reason === "sem-workspace") return "chave_invalida";
    if (reason === "longa-demais") return "muito_longa";
  }
  return "falha";
}

/** Tira só o motivo do erro: a mensagem da API não chega a `ops.diagnostics`. */
function diagnosticError(error: unknown): unknown {
  if (!(error instanceof Anthropic.APIError) || error.status === undefined) return error;
  return Object.assign(new Error("api"), {
    name: "ClaudeApi",
    code: `api-${error.status}-${apiReason(error)}`.slice(0, MAX_CODE),
  });
}

export function reportFailure(code: AssistantErrorCode, error: unknown): void {
  const status = error instanceof Anthropic.APIError ? error.status : undefined;
  const reason = error instanceof Anthropic.APIError ? apiReason(error) : undefined;
  console.error(JSON.stringify({ level: "error", msg: "assistant_failed", code, status, reason }));
  void captureError(diagnosticError(error), {
    service: "web",
    source: "action",
    route: "acao:assistente",
  });
}
