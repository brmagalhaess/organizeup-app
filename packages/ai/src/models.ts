// Modelo, preços e rotas. Preços da tabela da Anthropic para claude-opus-5-5 em 2026-10-31, em
// dólares por milhão de tokens. Conferir quando o modelo mudar.
import type Anthropic from "@anthropic-ai/sdk";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Effort = "low" | "medium" | "high";

export const MODEL = "claude-opus-5-5";

/** Beta do `fallbacks: "default"`: a recusa do modelo roda de novo no modelo que a Anthropic indica. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  /** Escrita de 5 minutos, a única usada aqui. */
  cacheWrite: number;
}

export const PRICES: Record<string, Price> = {
  [MODEL]: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  // Modelos para onde uma recusa pode cair.
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

/** Modelo desconhecido custa o mais caro da casa: o teto erra para o lado seguro. */
const UNKNOWN_PRICE: Price = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 };

const PER_MILLION = 1_000_000;

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function costUsd(usage: ModelUsage): number {
  const price = PRICES[usage.model] ?? UNKNOWN_PRICE;
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite) /
    PER_MILLION
  );
}

/**
 * Uso por modelo que rodou. Com recusa e fallback, `usage` de topo cobre só a tentativa final, e
 * cada tentativa está em `usage.iterations`.
 */
export function usageOf(message: Pick<Message, "model" | "usage">): ModelUsage[] {
  const { usage } = message;
  const entries = usage.iterations ?? [];
  const attempts = entries.flatMap((entry) =>
    entry.type === "message" || entry.type === "fallback_message"
      ? [
          {
            model: "model" in entry && entry.model ? String(entry.model) : String(message.model),
            inputTokens: entry.input_tokens,
            outputTokens: entry.output_tokens,
            cacheReadTokens: entry.cache_read_input_tokens,
            cacheWriteTokens: entry.cache_creation_input_tokens,
          },
        ]
      : [],
  );
  if (attempts.length > 0) return attempts;
  return [
    {
      model: String(message.model),
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    },
  ];
}

export type ToolKind = "leitura" | "simulacao" | "escrita";

export interface AiRoute {
  /** Fica em `ai_usage.route` e `ops.ai_stats.route`. */
  name: string;
  effort: Effort;
  maxTokens: number;
  /** Chamadas ao modelo por turno. A última sai sem ferramentas, para sempre haver resposta. */
  maxIterations: number;
  toolKinds: ToolKind[];
}

/** Só a conversa roda nesta fase. Rotina noturna e classificação entram como rotas novas. */
export const CHAT_ROUTE: AiRoute = {
  name: "chat",
  effort: "medium",
  maxTokens: 16_000,
  maxIterations: 8,
  toolKinds: ["leitura", "simulacao"],
};
