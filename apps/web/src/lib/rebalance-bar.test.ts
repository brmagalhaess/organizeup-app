import { describe, expect, it } from "vitest";
import { barSegments } from "./rebalance-bar";

describe("segmentos da barra de balanceamento", () => {
  it("sem meta, a barra inteira fica na cor normal", () => {
    expect(barSegments(42.5, null)).toEqual({ base: 42.5, excess: 0, overTarget: null });
  });

  it("abaixo ou na meta, não há excesso", () => {
    expect(barSegments(30, 40)).toEqual({ base: 30, excess: 0, overTarget: null });
    expect(barSegments(40, 40)).toEqual({ base: 40, excess: 0, overTarget: null });
  });

  it("acima da meta, o excesso começa na meta e diz quantos pontos passou", () => {
    expect(barSegments(55.5, 40)).toEqual({ base: 40, excess: 15.5, overTarget: 15.5 });
    expect(barSegments(15.5, 10)).toEqual({ base: 10, excess: 5.5, overTarget: 5.5 });
  });

  it("os trechos nunca passam de 100% da barra", () => {
    expect(barSegments(120, 40)).toEqual({ base: 40, excess: 60, overTarget: 80 });
    expect(barSegments(100, 0)).toEqual({ base: 0, excess: 100, overTarget: 100 });
  });

  it("a soma dos trechos é a alocação atual limitada à barra", () => {
    for (const [percent, target] of [
      [12.3, 10],
      [99.9, 50],
      [0.1, 0],
    ] as const) {
      const { base, excess } = barSegments(percent, target);
      expect(base + excess).toBeCloseTo(Math.min(100, percent), 5);
    }
  });
});
