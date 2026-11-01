// Loop de ferramentas da conversa. Regras que este arquivo segura:
// - o modelo nunca é chamado dentro de withHousehold: cada passo abre e fecha a própria transação;
// - consentimento e teto são conferidos no servidor antes de CADA chamada;
// - o custo vem do `usage` de cada resposta;
// - no log, só código de erro e contagens. Nada de texto da conversa.
import Anthropic from "@anthropic-ai/sdk";
import { withHousehold, householdTimezone, type TenantContext } from "@organizeup/db";
import { todayIn } from "@organizeup/domain";
import { aiLimits, assistantState, serviceDay, type AiLimits, type AssistantState } from "./access";
import { errorCode, reportFailure, type AssistantErrorCode } from "./api-errors";
import type { ModelClient, ModelMessage, ModelStream, StreamParams } from "./client";
import { SYSTEM_PROMPT, turnContext } from "./instructions";
import { CHAT_ROUTE, MODEL, usageOf, type AiRoute, type ModelUsage } from "./models";
import { loadPrivacyFilter, type PrivacyFilter } from "./privacy";
import {
  appendMessage,
  createThread,
  threadExists,
  threadMessages,
  type MessageStatus,
  type StoredMessage,
  type ThreadMessage,
} from "./threads";
import { apiToolsFor, executeTool, toolsFor } from "./tools";
import { recordUsage } from "./usage";
import { knownNumbers, mentionsInvestment, uncheckedAmounts } from "./verify";

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

export type { AssistantErrorCode };

export type AssistantEvent =
  | { type: "thread"; id: string }
  | { type: "text"; delta: string }
  /** Descarta o que já apareceu desta resposta: recusa no meio do texto. */
  | { type: "discard" }
  | { type: "tool"; label: string }
  | {
      type: "done";
      status: MessageStatus;
      text: string;
      investment: boolean;
      uncheckedNumbers: boolean;
    }
  | { type: "blocked"; state: AssistantState }
  | { type: "error"; code: AssistantErrorCode };

export const REFUSAL_TEXT =
  "Não consigo ajudar com esse pedido. Se quiser, pergunte de outro jeito ou fale de outro assunto das suas finanças.";
export const EMPTY_TEXT = "Não consegui formular uma resposta. Pode tentar de novo?";
export const LIMIT_TEXT =
  "Paramos por aqui porque o limite de uso de hoje foi atingido. O resto do OrganizeUp segue normal.";

/** Mensagens do histórico enviadas ao modelo. Só texto: sem resultados de ferramenta antigos. */
const HISTORY_MESSAGES = 20;

export interface ChatTurnInput {
  ctx: TenantContext;
  client: ModelClient;
  message: string;
  threadId?: string | null | undefined;
  emit: (event: AssistantEvent) => void;
  signal?: AbortSignal | undefined;
  route?: AiRoute;
  limits?: AiLimits;
  /** Só nos testes: o dia de contagem. */
  day?: string;
}

/** Só texto, começando em `user`. Sem blocos de pensamento: não há o que invalidar no histórico. */
function historyParams(rows: ThreadMessage[], privacy: PrivacyFilter): MessageParam[] {
  const usable = rows.filter((row) => row.text.trim().length > 0).slice(-HISTORY_MESSAGES);
  const first = usable.findIndex((row) => row.role === "user");
  return first < 0
    ? []
    : usable.slice(first).map((row) => ({
        role: row.role,
        content: row.role === "user" ? privacy.scrub(row.text) : row.text,
      }));
}

/**
 * O que volta ao modelo depois de uma ferramenta. Depois de um fallback no meio da resposta, o que
 * veio antes do bloco `fallback` não pode voltar, com exceção do texto.
 */
export function echoContent(content: ContentBlock[]): ContentBlock[] {
  const boundary = content.findLastIndex((block) => block.type === "fallback");
  return content.filter(
    (block, index) => block.type !== "fallback" && (index > boundary || block.type === "text"),
  );
}

/** Parâmetros estáveis primeiro: ferramentas e instruções formam o prefixo do cache. */
export function requestParams(
  route: AiRoute,
  messages: MessageParam[],
  withTools: boolean,
): StreamParams {
  return {
    model: MODEL,
    max_tokens: route.maxTokens,
    output_config: { effort: route.effort },
    // Marca fixa nas instruções e cache automático para a parte que cresce.
    cache_control: { type: "ephemeral" },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: apiToolsFor(route),
    tool_choice: withTools ? { type: "auto" } : { type: "none" },
    messages,
  };
}

const CHARS_PER_TOKEN = 4;

/** Parada no meio: a API não fechou a conta, então estima a saída pelo que chegou. */
function partialUsage(stream: ModelStream, chars: number): ModelUsage[] {
  const usage = stream.currentMessage?.usage;
  if (!usage) return [];
  return [
    {
      model: String(stream.currentMessage?.model ?? MODEL),
      inputTokens: usage.input_tokens,
      outputTokens: Math.ceil(chars / CHARS_PER_TOKEN),
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    },
  ];
}

interface Prepared {
  threadId: string;
  today: string;
  privacy: PrivacyFilter;
  history: MessageParam[];
}

/** Grava a pergunta antes de chamar o modelo: se a chamada cair, ela continua na conversa. */
async function prepare(input: ChatTurnInput): Promise<Prepared | null> {
  const { ctx, message } = input;
  return withHousehold(ctx, async (tx) => {
    const privacy = await loadPrivacyFilter(tx, ctx.householdId);
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    let threadId = input.threadId ?? null;
    let earlier: ThreadMessage[] = [];
    if (threadId) {
      if (!(await threadExists(tx, threadId))) return null;
      earlier = await threadMessages(tx, threadId);
    } else {
      threadId = await createThread(tx, ctx, message);
    }
    await appendMessage(tx, ctx, threadId, "user", { text: message });
    return { threadId, today, privacy, history: historyParams(earlier, privacy) };
  });
}

interface Answer {
  text: string;
  status: MessageStatus;
  tools: string[];
  investment: boolean;
  /** Texto que entra na conferência de números: saídas de ferramenta e a pergunta. */
  sources: string[];
}

const isToolUse = (block: ContentBlock): block is Anthropic.Beta.Messages.BetaToolUseBlock =>
  block.type === "tool_use";

async function consume(
  input: ChatTurnInput,
  params: StreamParams,
  onText: (delta: string) => void,
): Promise<{ message: ModelMessage } | { aborted: ModelStream }> {
  const stream = input.client.stream(params, { signal: input.signal });
  stream.on("text", onText);
  try {
    return { message: await stream.finalMessage() };
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError || input.signal?.aborted) {
      return { aborted: stream };
    }
    throw error;
  }
}

async function converse(input: ChatTurnInput, prepared: Prepared): Promise<Answer> {
  const { ctx, emit, signal, route = CHAT_ROUTE, limits = aiLimits() } = input;
  const day = input.day ?? serviceDay();
  const tools = toolsFor(route);
  const question = prepared.privacy.scrub(input.message);
  const messages: MessageParam[] = [
    ...prepared.history,
    { role: "user", content: question },
    { role: "system", content: turnContext({ today: prepared.today }) },
  ];
  const answer: Answer = {
    text: "",
    status: "completa",
    tools: [],
    investment: false,
    sources: [question],
  };

  for (let iteration = 0; iteration < route.maxIterations; iteration += 1) {
    if (signal?.aborted) return { ...answer, status: "parada" };
    const state = await assistantState({ ctx, limits, day });
    if (state !== "pronto") {
      emit({ type: "text", delta: `${answer.text ? "\n\n" : ""}${LIMIT_TEXT}` });
      answer.text += `${answer.text ? "\n\n" : ""}${LIMIT_TEXT}`;
      return { ...answer, status: "limite" };
    }

    const withTools = iteration < route.maxIterations - 1;
    let chars = 0;
    const result = await consume(input, requestParams(route, messages, withTools), (delta) => {
      chars += delta.length;
      answer.text += delta;
      emit({ type: "text", delta });
    });
    if ("aborted" in result) {
      await recordUsage(ctx, route.name, day, partialUsage(result.aborted, chars));
      return { ...answer, status: "parada" };
    }
    const { message } = result;
    await recordUsage(ctx, route.name, day, usageOf(message));

    if (message.stop_reason === "refusal") {
      // Pode ter cortado uma ferramenta no meio e deixado texto pela metade: nada disso vale.
      emit({ type: "discard" });
      emit({ type: "text", delta: REFUSAL_TEXT });
      return { ...answer, text: REFUSAL_TEXT, status: "recusada" };
    }
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: echoContent(message.content) });
      continue;
    }

    const calls = message.content.filter(isToolUse);
    // Entrada cortada em max_tokens passa no esquema: não roda a ferramenta.
    if (calls.length === 0 || message.stop_reason === "max_tokens") return answer;

    messages.push({ role: "assistant", content: echoContent(message.content) });
    const results: ToolResult[] = [];
    for (const call of calls) {
      const outcome = await executeTool(tools, ctx, prepared.privacy, call.name, call.input);
      if (outcome.ok) {
        answer.tools.push(outcome.label);
        answer.investment ||= outcome.investment;
        answer.sources.push(outcome.content);
        emit({ type: "tool", label: outcome.label });
        results.push({ type: "tool_result", tool_use_id: call.id, content: outcome.content });
      } else {
        console.warn(
          JSON.stringify({ level: "warn", msg: "assistant_tool_failed", code: outcome.code }),
        );
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: outcome.content,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: results });
    if (answer.text && !answer.text.endsWith("\n\n")) {
      answer.text += "\n\n";
      emit({ type: "text", delta: "\n\n" });
    }
  }
  return answer;
}

/** Um turno da conversa, do portão à gravação da resposta. Não lança: tudo vira evento. */
export async function runChatTurn(input: ChatTurnInput): Promise<void> {
  const { ctx, emit, limits = aiLimits() } = input;
  const day = input.day ?? serviceDay();
  try {
    const state = await assistantState({ ctx, limits, day });
    if (state !== "pronto") {
      emit({ type: "blocked", state });
      return;
    }
    const prepared = await prepare(input);
    if (!prepared) {
      emit({ type: "error", code: "sem_conversa" });
      return;
    }
    emit({ type: "thread", id: prepared.threadId });

    let answer: Answer;
    try {
      answer = await converse(input, prepared);
    } catch (error) {
      const code = errorCode(error);
      reportFailure(code, error);
      emit({ type: "error", code });
      return;
    }

    const stored: StoredMessage = {
      text: answer.text.trim() || (answer.status === "parada" ? "" : EMPTY_TEXT),
      tools: answer.tools,
      status: answer.status,
      investment: answer.investment || mentionsInvestment(answer.text),
      uncheckedNumbers: uncheckedAmounts(answer.text, knownNumbers(answer.sources)).length > 0,
    };
    await withHousehold(ctx, (tx) =>
      appendMessage(tx, ctx, prepared.threadId, "assistant", stored),
    );
    emit({
      type: "done",
      status: answer.status,
      text: stored.text,
      investment: stored.investment === true,
      uncheckedNumbers: stored.uncheckedNumbers === true,
    });
  } catch (error) {
    reportFailure("falha", error);
    emit({ type: "error", code: "falha" });
  }
}
