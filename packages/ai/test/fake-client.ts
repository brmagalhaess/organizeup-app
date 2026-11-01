// Cliente falso do modelo: devolve respostas prontas e guarda o que recebeu. Nada aqui chama a API.
import type { ModelClient, ModelMessage, ModelStream, StreamParams } from "../src/client";

export type Step =
  | ModelMessage
  | Error
  | ((
      params: StreamParams,
      options: { signal?: AbortSignal | undefined },
    ) => Promise<ModelMessage>);

export interface UsageOver {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  iterations?: unknown[] | null;
}

export function modelMessage(
  content: unknown[],
  stop_reason: string = "end_turn",
  usage: UsageOver = {},
  model = "claude-haiku-5-5",
): ModelMessage {
  return {
    id: "msg_teste",
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      iterations: null,
      ...usage,
    },
  } as unknown as ModelMessage;
}

export const textReply = (text: string, usage?: UsageOver) =>
  modelMessage(
    [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text },
    ],
    "end_turn",
    usage,
  );

export const toolCall = (name: string, input: unknown, id = `toolu_${name}`) => ({
  type: "tool_use",
  id,
  name,
  input,
});

export function fakeClient(script: Step[]) {
  const calls: StreamParams[] = [];
  const client: ModelClient = {
    stream(params, options) {
      calls.push(structuredClone(params));
      const step = script[calls.length - 1];
      if (!step) throw new Error("O roteiro do cliente falso acabou.");
      let onText: ((delta: string) => void) | undefined;
      const stream = {
        currentMessage: undefined as ModelMessage | undefined,
        on(_event: string, listener: (delta: string) => void) {
          onText = listener;
          return stream;
        },
        async finalMessage() {
          if (step instanceof Error) throw step;
          const message = typeof step === "function" ? await step(params, options) : step;
          for (const block of message.content) {
            if (block.type === "text") onText?.(block.text);
          }
          return message;
        },
      };
      return stream as unknown as ModelStream;
    },
  };
  return { client, calls };
}
