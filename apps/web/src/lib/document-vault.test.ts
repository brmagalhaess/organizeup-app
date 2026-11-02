import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { documentHash, openDocument, sealDocument, vaultKeyId, vaultReady } from "./document-vault";

// CPF fictício: a faixa 000 não está em uso.
const CPF = "00000000191";
const ref = { userId: "conta-a", field: "cpf" as const };

describe("cofre de documentos", () => {
  beforeEach(() => {
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("cifra sem deixar o texto à vista e abre de volta", () => {
    const sealed = sealDocument(CPF, ref);
    expect(sealed).not.toContain(CPF);
    expect(Buffer.from(sealed.split(".")[4]!, "base64url").toString("utf8")).not.toContain(CPF);
    expect(openDocument(sealed, ref)).toBe(CPF);
  });

  it("guarda a impressão digital da chave, que não muda entre gravações e não revela a chave", () => {
    const keyId = vaultKeyId()!;
    expect(sealDocument(CPF, ref).split(".").slice(0, 2)).toEqual(["v1", keyId]);
    expect(keyId).toMatch(/^[\w-]{8}$/);
    expect(process.env.DOCUMENT_ENCRYPTION_KEY).not.toContain(keyId);
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(vaultKeyId()).not.toBe(keyId);
  });

  it.each([1, 4, 8, 12, 13, 14, 15])("etiqueta curta, de %i bytes, não abre", (bytes) => {
    const [version, keyId, iv, tag, data] = sealDocument(CPF, ref).split(".");
    const short = Buffer.from(tag!, "base64url").subarray(0, bytes).toString("base64url");
    expect(openDocument([version, keyId, iv, short, data].join("."), ref)).toBeNull();
  });

  it.each([8, 11, 13, 16])("IV de %i bytes não abre", (bytes) => {
    const [version, keyId, , tag, data] = sealDocument(CPF, ref).split(".");
    const iv = randomBytes(bytes).toString("base64url");
    expect(openDocument([version, keyId, iv, tag, data].join("."), ref)).toBeNull();
  });

  it("parte a mais no valor não abre", () => {
    expect(openDocument(`${sealDocument(CPF, ref)}.x`, ref)).toBeNull();
  });

  it("dois cifrados do mesmo documento são diferentes", () => {
    expect(sealDocument(CPF, ref)).not.toBe(sealDocument(CPF, ref));
  });

  it("copiar o cifrado para outra conta ou outro campo não abre", () => {
    const sealed = sealDocument(CPF, ref);
    expect(openDocument(sealed, { ...ref, userId: "conta-b" })).toBeNull();
    expect(openDocument(sealed, { ...ref, field: "cnpj" })).toBeNull();
  });

  it("valor adulterado, formato estranho ou outra chave não abrem", () => {
    const sealed = sealDocument(CPF, ref);
    const [version, keyId, iv, tag, data] = sealed.split(".");
    const flipped = `${data!.slice(0, -2)}${data!.endsWith("AA") ? "BB" : "AA"}`;
    expect(openDocument([version, keyId, iv, tag, flipped].join("."), ref)).toBeNull();
    expect(openDocument(CPF, ref)).toBeNull();
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(openDocument(sealed, ref)).toBeNull();
  });

  it("o hash é estável, separa os tipos e depende da chave", () => {
    const hash = documentHash("cpf", CPF);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(documentHash("cpf", CPF)).toBe(hash);
    expect(documentHash("cnpj", CPF)).not.toBe(hash);
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(documentHash("cpf", CPF)).not.toBe(hash);
  });

  it.each([
    undefined,
    "",
    "   ",
    "curta",
    randomBytes(16).toString("base64"),
    randomBytes(33).toString("base64"),
    `${randomBytes(32).toString("base64")}!!!!`,
    "-".repeat(43) + "=",
    randomBytes(32).toString("base64url"),
  ])("sem chave válida (%j) nada é cifrado e nada sai em texto puro", (value) => {
    vi.stubEnv("DOCUMENT_ENCRYPTION_KEY", value as string);
    expect(vaultReady()).toBe(false);
    expect(() => sealDocument(CPF, ref)).toThrow("document_key_missing");
    expect(() => documentHash("cpf", CPF)).toThrow("document_key_missing");
  });
});
