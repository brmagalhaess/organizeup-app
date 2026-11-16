// As cores da marca, as mesmas de apps/web/src/app/globals.css (paleta grafite com verde, ADR-0044),
// no claro e no escuro. Exceção: no app a receita é verde (pedido do fundador em 16/11/2026), não azul.
import { useColorScheme } from "react-native";

const light = {
  background: "#f5f5f6",
  card: "#ffffff",
  cardSoft: "#fafafa",
  ink: "#18191b",
  muted: "#5c6066",
  line: "#e2e3e6",
  brand: "#167a50",
  onBrand: "#ffffff",
  /** Faixa grafite da marca: não muda no escuro. */
  graphite: "#17181b",
  onGraphite: "#f5f5f6",
  accent: "#45c88a",
  income: "#167a50",
  expense: "#b42318",
  danger: "#b42318",
  dangerSoft: "#fdecea",
  warning: "#8a5a00",
  warningSoft: "#fdf3dc",
};

const dark: typeof light = {
  background: "#0e0f11",
  card: "#17191c",
  cardSoft: "#1d1f23",
  ink: "#ececee",
  muted: "#9a9da3",
  line: "#2a2d32",
  brand: "#3fb37f",
  onBrand: "#0e0f11",
  graphite: "#1d1f23",
  onGraphite: "#f5f5f6",
  accent: "#45c88a",
  income: "#3fb37f",
  expense: "#f0897e",
  danger: "#f0897e",
  dangerSoft: "#3a1f1c",
  warning: "#eec26a",
  warningSoft: "#33290f",
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}
