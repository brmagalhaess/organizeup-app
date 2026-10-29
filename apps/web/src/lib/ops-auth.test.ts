import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isAuthorizedOpsRequest } from "./ops-auth";

const token = "a".repeat(40);
const hash = createHash("sha256").update(token).digest("hex");

describe("isAuthorizedOpsRequest", () => {
  it("aceita bearer cujo hash está configurado", () => {
    expect(isAuthorizedOpsRequest(`Bearer ${token}`, `xyz,${hash}`)).toBe(true);
  });
  it("recusa token desconhecido, curto, ausente ou sem configuração", () => {
    expect(isAuthorizedOpsRequest(`Bearer ${"b".repeat(40)}`, hash)).toBe(false);
    expect(isAuthorizedOpsRequest("Bearer curto", hash)).toBe(false);
    expect(isAuthorizedOpsRequest(null, hash)).toBe(false);
    expect(isAuthorizedOpsRequest(`Bearer ${token}`, undefined)).toBe(false);
    expect(isAuthorizedOpsRequest(`Bearer ${token}`, "")).toBe(false);
  });
});
