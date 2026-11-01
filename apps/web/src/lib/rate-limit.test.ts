import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("limite por chave", () => {
  it("segura depois do limite e libera na janela seguinte", () => {
    const allow = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect([allow("a", 0), allow("a", 1), allow("a", 2)]).toEqual([true, true, false]);
    expect(allow("b", 3)).toBe(true);
    expect(allow("a", 1000)).toBe(true);
  });

  it("não guarda chaves sem fim", () => {
    const allow = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
    allow("a", 0);
    allow("b", 0);
    allow("c", 0);
    expect(allow("a", 1)).toBe(true);
  });
});
