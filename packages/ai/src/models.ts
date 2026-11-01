// Modelo, preços e rotas. Preços da tabela da Anthropic em 2026-11-01, em dólares por milhão de
// tokens. Conferir quando o modelo mudar.
import type Anthropic from "@anthropic-ai/sdk";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Effort = "low" | "medium" | "high";

/** Escolha do fundador em 2026-11-01, por custo. Este modelo não tem `fallbacks` no servidor. */
export const MODEL = "claude-haiku-5-5";

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  /** Escrita de 5 minutos, a única usada aqui. */
  cacheWrite: number;
  /** Prompt acima de `above` tokens custa `factor` vezes mais, em tudo. */
  longPrompt?: { above: number; factor: number };
}

export const PRICES: Record<string, Price> = {
  [MODEL]: {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    longPrompt: { above: 100_000, factor: 5 },
  },
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
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const long = price.longPrompt && prompt > price.longPrompt.above ? price.longPrompt.factor : 1;
  return (
    (long *
      (usage.inputTokens * price.input +
        usage.outputTokens * price.output +
        usage.cacheReadTokens * price.cacheRead +
        usage.cacheWriteTokens * price.cacheWrite)) /
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
  toolKinds: ["leitura", "simulacao", "escrita"],
};
