import { describe, expect, it } from "vitest";
import { ageFromBirth, isValidTimezone, todayIn } from "../src/dates";

describe("dates", () => {
  it("usa a data civil do fuso do household", () => {
    // 02:30 UTC de 1º de março ainda é 28 de fevereiro em São Paulo (UTC-3).
    const instant = new Date("2026-03-01T02:30:00Z");
    expect(todayIn("America/Sao_Paulo", instant)).toBe("2026-02-28");
    expect(todayIn("UTC", instant)).toBe("2026-03-01");
  });

  it("valida fusos IANA", () => {
    expect(isValidTimezone("America/Manaus")).toBe(true);
    expect(isValidTimezone("Marte/Olympus")).toBe(false);
  });

  it("calcula idade por mês/ano", () => {
    expect(ageFromBirth(1990, 6, { year: 2026, month: 5 })).toBe(35);
    expect(ageFromBirth(1990, 6, { year: 2026, month: 6 })).toBe(36);
  });
});
