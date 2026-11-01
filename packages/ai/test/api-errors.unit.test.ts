import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { apiReason, errorCode } from "../src/api-errors";

const badRequest = (message: string) =>
  new Anthropic.BadRequestError(
    400,
    { type: "error", error: { type: "invalid_request_error", message } },
    message,
    new Headers(),
  );

describe("motivo do erro da API", () => {
  it.each([
    ["Your credit balance is too low to access the API.", "sem-credito", "chave_invalida"],
    ["Unexpected value(s) `x` for the `anthropic-beta` header.", "beta-recusado", "falha"],
    ["prompt is too long: 2 tokens > 1 maximum", "longa-demais", "muito_longa"],
    ["messages.1.content: Input should be a valid list", "messages.1.content", "falha"],
    ["Algo com dado: Fulana de Tal pagou 300", "outro", "falha"],
  ])("%s", (message, reason, code) => {
    expect(apiReason(badRequest(message))).toBe(reason);
    expect(errorCode(badRequest(message))).toBe(code);
  });

  it("402 é falta de crédito", () => {
    const error = new Anthropic.APIError(402, undefined, "x", new Headers());
    expect(apiReason(error)).toBe("sem-credito");
    expect(errorCode(error)).toBe("chave_invalida");
  });
});
