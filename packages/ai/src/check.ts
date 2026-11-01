// Teste de ponta a ponta para o painel: mesmo formato da conversa, ida e volta de ferramenta incluída,
// com pergunta fixa e sem nenhum dado de família. O custo entra no teto, em rota própria.
import Anthropic from "@anthropic-ai/sdk";
import { serviceDay } from "./access";
import { apiMessage, apiReason } from "./api-errors";
import type { ModelClient } from "./client";
import { turnContext } from "./instructions";
import { echoContent, requestParams } from "./loop";
import { CHAT_ROUTE, usageOf, type AiRoute } from "./models";
import { recordServiceUsage } from "./usage";

const CHECK_ROUTE: AiRoute = { ...CHAT_ROUTE, name: "teste" };
const CHECK_QUESTION = "Teste do sistema: chame listar_categorias uma vez e responda apenas: ok.";
const CHECK_RESULT = '{"categorias":[]}';
const MAX_STEPS = 3;

export interface ModelCheck {
  ok: boolean;
  steps: number;
  toolUsed: boolean;
  model: string | null;
  status: number | null;
  reason: string | null;
  /** Texto da API. A pergunta é fixa, então não há dado de ninguém aqui. Só para o painel. */
  detail: string | null;
}

export async function checkModel(client: ModelClient): Promise<ModelCheck> {
  const day = serviceDay();
  const messages: Parameters<typeof requestParams>[1] = [
    { role: "user", content: CHECK_QUESTION },
    { role: "system", content: turnContext({ today: day }) },
  ];
  const check: ModelCheck = {
    ok: false,
    steps: 0,
    toolUsed: false,
    model: null,
    status: null,
    reason: null,
    detail: null,
  };
  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const message = await client
        .stream(requestParams(CHECK_ROUTE, messages, step < MAX_STEPS - 1), {})
        .finalMessage();
      check.steps += 1;
      check.model = String(message.model);
      await recordServiceUsage(day, CHECK_ROUTE.name, usageOf(message));
      if (message.stop_reason === "refusal") return { ...check, reason: "recusa" };
      const calls = message.content.filter((block) => block.type === "tool_use");
      if (calls.length === 0) return { ...check, ok: true };
      check.toolUsed = true;
      messages.push({ role: "assistant", content: echoContent(message.content) });
      messages.push({
        role: "user",
        content: calls.map((call) => ({
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: CHECK_RESULT,
        })),
      });
    }
    return { ...check, reason: "sem-fim" };
  } catch (error) {
    if (!(error instanceof Anthropic.APIError)) return { ...check, reason: "falha" };
    return {
      ...check,
      status: error.status ?? null,
      reason: apiReason(error),
      detail: apiMessage(error) || null,
    };
  }
}
