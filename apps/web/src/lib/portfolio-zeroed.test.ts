import { describe, expect, it } from "vitest";
import { isZeroed, splitZeroed } from "./portfolio-zeroed";

const row = (id: string, quantity: string, value: string) => ({
  id,
  value,
  position: { quantity },
});

describe("ativos com saldo zero na carteira", () => {
  it("zerado é quem não tem quantidade nem valor", () => {
    expect(isZeroed(row("a", "0", "0.00"))).toBe(true);
    expect(isZeroed(row("b", "10", "0.00"))).toBe(false);
    expect(isZeroed(row("c", "0", "150.00"))).toBe(false);
    expect(isZeroed(row("d", "0.5", "12.30"))).toBe(false);
  });

  it("separa os visíveis dos zerados sem mudar a ordem", () => {
    const rows = [row("a", "10", "100.00"), row("b", "0", "0.00"), row("c", "0", "50.00")];
    const { visible, zeroed } = splitZeroed(rows);
    expect(visible.map((r) => r.id)).toEqual(["a", "c"]);
    expect(zeroed.map((r) => r.id)).toEqual(["b"]);
  });

  it("carteira sem zerados fica igual", () => {
    const rows = [row("a", "1", "1.00")];
    expect(splitZeroed(rows)).toEqual({ visible: rows, zeroed: [] });
  });
});
