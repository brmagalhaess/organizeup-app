import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { connectionVaultReady, openSecret, sealSecret } from "./connection-vault";
import { sealDocument } from "./document-vault";

// Valor fictício, no formato de um Client Secret.
const SECRET = "3f2b8c1d-0a4e-4b7c-9d6e-5f1a2b3c4d5e";
const ref = {
  householdId: "familia-a",
  userId: "pessoa-a",
  connectionId: "conexao-a",
  field: "clientSecret" as const,
};

describe("cofre das chaves de conexão", () => {
  beforeEach(() => {
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("cifra sem deixar o texto à vista e abre de volta", () => {
    const sealed = sealSecret(SECRET, ref);
    expect(sealed).not.toContain(SECRET);
    expect(Buffer.from(sealed.split(".")[4]!, "base64url").toString("utf8")).not.toContain(SECRET);
    expect(openSecret(sealed, ref)).toBe(SECRET);
  });

  it("não abre para outra pessoa, outra família, outra conexão nem outro campo", () => {
    const sealed = sealSecret(SECRET, ref);
    expect(openSecret(sealed, { ...ref, connectionId: "conexao-b" })).toBeNull();
    expect(openSecret(sealed, { ...ref, userId: "pessoa-b" })).toBeNull();
    expect(openSecret(sealed, { ...ref, householdId: "familia-b" })).toBeNull();
    expect(openSecret(sealed, { ...ref, field: "clientId" })).toBeNull();
  });

  it("não abre valor adulterado nem com a chave trocada", () => {
    const sealed = sealSecret(SECRET, ref);
    const parts = sealed.split(".");
    parts[4] = Buffer.from("outro valor").toString("base64url");
    expect(openSecret(parts.join("."), ref)).toBeNull();
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(openSecret(sealed, ref)).toBeNull();
  });

  it("usa uma chave própria: o cofre de documentos não abre conexão", () => {
    const document = sealDocument(SECRET, { userId: "pessoa-a", field: "cpf" });
    expect(openSecret(document, ref)).toBeNull();
  });

  it("sem a variável, não cifra e avisa que não está pronto", () => {
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", "");
    expect(connectionVaultReady()).toBe(false);
    expect(() => sealSecret(SECRET, ref)).toThrow("connection_key_missing");
  });
});
