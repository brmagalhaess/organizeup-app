// Segmentos da barra de balanceamento: até a meta na cor normal, o excesso em vermelho.

export interface BarSegments {
  /** Largura (0 a 100) do trecho na cor normal: a alocação até o nível da meta. */
  base: number;
  /** Largura (0 a 100) do trecho em vermelho: o que passou da meta. Zero quando não passou. */
  excess: number;
  /** Pontos percentuais acima da meta, com uma casa. Null quando não passou ou sem meta. */
  overTarget: number | null;
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

/** Divide a alocação atual (`percent`) em dois trechos pela meta (`target`), ambos de 0 a 100. */
export function barSegments(percent: number, target: number | null): BarSegments {
  const current = clamp(percent);
  if (target === null || percent <= target) return { base: current, excess: 0, overTarget: null };
  const base = clamp(target);
  return { base, excess: round1(current - base), overTarget: round1(percent - target) };
}
