// O que o gráfico "Mês a mês" de proventos mostra quando o período inteiro soma zero.
import { money } from "@organizeup/domain";

export type MonthlyChartState =
  /** Há valor pago ou anunciado em algum mês: as barras aparecem. */
  | "barras"
  /** Nada pago nem anunciado no período. */
  | "vazio";

export function monthlyChartState(
  points: ReadonlyArray<{ paid: string; announced: string }>,
): MonthlyChartState {
  return points.some((point) => money(point.paid).gt(0) || money(point.announced).gt(0))
    ? "barras"
    : "vazio";
}
