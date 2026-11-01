import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkModel } from "../src/check";
import { fakeClient, modelMessage, textReply, toolCall } from "./fake-client";

const recorded = vi.hoisted(() => ({ recordServiceUsage: vi.fn(async () => undefined) }));
vi.mock("../src/usage", () => recorded);

describe("teste da IA no painel", () => {
  beforeEach(() => recorded.recordServiceUsage.mockClear());

  it("faz a ida e volta da ferramenta sem dado de família", async () => {
    const { client, calls } = fakeClient([
      modelMessage([toolCall("listar_categorias", {})], "tool_use"),
      textReply("ok"),
    ]);
    const check = await checkModel(client);
    expect(check).toMatchObject({ ok: true, steps: 2, toolUsed: true });
    expect(calls[1]?.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", content: '{"categorias":[]}' }],
    });
    expect(recorded.recordServiceUsage).toHaveBeenCalledTimes(2);
  });

  it("mostra o que a API respondeu", async () => {
    const message = "tools.0.strict: Extra inputs are not permitted";
    const { client } = fakeClient([
      new Anthropic.BadRequestError(
        400,
        { type: "error", error: { type: "invalid_request_error", message } },
        message,
        new Headers(),
      ),
    ]);
    expect(await checkModel(client)).toMatchObject({
      ok: false,
      steps: 0,
      status: 400,
      reason: "tools.0.strict",
      detail: message,
    });
  });
});
