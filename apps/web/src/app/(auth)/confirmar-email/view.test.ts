import { describe, expect, it } from "vitest";
import { viewFor } from "./view";

describe("tela da volta do link", () => {
  it("link de outra conta é neutro, com qualquer sessão", () => {
    expect(viewFor(undefined, "outra-conta", false)).toBe("other");
    expect(viewFor(undefined, "outra-conta", true)).toBe("other");
    expect(viewFor(undefined, "outra-conta", null)).toBe("other");
  });

  it("com sessão de e-mail não confirmado, o endereço nunca mostra sucesso", () => {
    expect(viewFor(undefined, "confirmado", false)).toBe("invalid");
    expect(viewFor(undefined, "ja-confirmado", false)).toBe("invalid");
  });

  it("sem estado nem erro, link inválido", () => {
    expect(viewFor(undefined, undefined, null)).toBe("invalid");
  });

  it("erro vem antes do estado", () => {
    expect(viewFor("MAINTENANCE", "outra-conta", true)).toBe("maintenance");
    expect(viewFor("TOKEN_EXPIRED", undefined, null)).toBe("expired");
    expect(viewFor("TOKEN_EXPIRED", undefined, true)).toBe("already");
  });
});
