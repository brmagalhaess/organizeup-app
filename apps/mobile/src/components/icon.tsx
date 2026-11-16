// Ícones do app: os símbolos do próprio sistema (SF Symbols no iPhone, Material no Android), num
// círculo com a cor do assunto. Desenho nativo, sem imagem própria para manter.
import { SymbolView } from "expo-symbols";
import { View } from "react-native";
import type { Entry } from "@/lib/api";
import { useTheme, type Theme } from "@/lib/theme";

const SYMBOLS = {
  account: { ios: "building.columns.fill", android: "account_balance" },
  card: { ios: "creditcard.fill", android: "credit_card" },
  debt: { ios: "banknote.fill", android: "payments" },
  // Receita sobe (seta para cima, verde); despesa desce (seta para baixo, vermelha).
  income: { ios: "arrow.up.right", android: "north_east" },
  expense: { ios: "arrow.down.right", android: "south_east" },
  goal: { ios: "target", android: "savings" },
} as const;

export type IconName = keyof typeof SYMBOLS;

function colorOf(name: IconName, theme: Theme): string {
  switch (name) {
    case "income":
      return theme.income;
    case "expense":
    case "debt":
      return theme.expense;
    case "card":
      return theme.warning;
    default:
      return theme.brand;
  }
}

/** Ícone redondo, com fundo claro da mesma cor do traço. */
export function Icon({ name, size = 36 }: { name: IconName; size?: number }) {
  const theme = useTheme();
  const color = colorOf(name, theme);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        // Mesma cor com 12% de opacidade: funciona no claro e no escuro.
        backgroundColor: `${color}1F`,
      }}
    >
      <SymbolView
        name={{ ios: SYMBOLS[name].ios, android: SYMBOLS[name].android }}
        size={Math.round(size * 0.5)}
        tintColor={color}
        weight="semibold"
      />
    </View>
  );
}

/** Que ícone cada lançamento leva: parcela de dívida, fatura, meta ou entrada/saída comum. */
export function entryIcon(entry: Pick<Entry, "source" | "kind">): IconName {
  if (entry.source === "parcela") return "debt";
  if (entry.source === "fatura") return "card";
  if (entry.source === "meta") return "goal";
  return entry.kind === "receita" ? "income" : "expense";
}
