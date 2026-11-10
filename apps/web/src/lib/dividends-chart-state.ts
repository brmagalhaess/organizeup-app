// O que o gráfico "Mês a mês" de proventos mostra quando os 12 meses somam zero.
import { money } from "@organizeup/domain";

export type MonthlyChartState =
  /** Há valor em algum mês: as barras aparecem. */
  | "barras"
  /** Nada pago nos 12 meses, mas há provento anunciado: o aviso diz quando ele entra. */
  | "a_receber"
  /** Nada pago e nada anunciado. */
  | "vazio";

export function monthlyChartState(
  points: ReadonlyArray<{ net: string }>,
  upcomingCount: number,
): MonthlyChartState {
  if (points.some((point) => money(point.net).gt(0))) return "barras";
  return upcomingCount > 0 ? "a_receber" : "vazio";
}
