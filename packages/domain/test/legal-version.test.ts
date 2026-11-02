import { describe, expect, it } from "vitest";
import { compareLegalVersions, legalVersionAtLeast } from "../src/legal-version";

describe("versão legal", () => {
  it("compara por data e depois por número, e não como texto", () => {
    expect("2026-11-01.10" >= "2026-11-01.3").toBe(false);
    expect(legalVersionAtLeast("2026-11-01.10", "2026-11-01.3")).toBe(true);
    expect(legalVersionAtLeast("2026-11-01.3", "2026-11-01.10")).toBe(false);
    expect(compareLegalVersions("2026-11-02", "2026-11-01.99")).toBeGreaterThan(0);
    expect(compareLegalVersions("2026-11-01.2", "2026-11-01.2")).toBe(0);
  });

  it("sem número vale como .0", () => {
    expect(legalVersionAtLeast("2026-11-01", "2026-11-01.1")).toBe(false);
    expect(legalVersionAtLeast("2026-11-01.1", "2026-11-01")).toBe(true);
  });

  it.each([null, undefined, "", "abc", "2026-11-01.x", "2026-11-01.3 "])(
    "aceite vazio ou estranho (%j) não cobre nada",
    (version) => {
      expect(legalVersionAtLeast(version, "2026-11-01.3")).toBe(false);
    },
  );
});
