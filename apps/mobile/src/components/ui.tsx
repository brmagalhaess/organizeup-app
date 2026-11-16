// Peças de tela do app: poucas, com alvo de toque de 44pt e rótulos para leitor de tela.
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ApiError, Entry } from "@/lib/api";
import { errorText, t } from "@/lib/strings";
import { useTheme } from "@/lib/theme";

/** Tela de aba: título grande, puxar para atualizar e espaço para a barra de abas. */
export function Screen({
  title,
  children,
  refreshing = false,
  onRefresh,
  action,
}: {
  title: string;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  action?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + 72,
        paddingHorizontal: 16,
        gap: 16,
      }}
      contentInsetAdjustmentBehavior="never"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />
        ) : undefined
      }
    >
      <View style={styles.titleRow}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={[styles.title, { color: theme.ink, flex: 1 }]}
        >
          {title}
        </Text>
        {action}
      </View>
      {children}
    </ScrollView>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
      {title ? (
        <Text accessibilityRole="header" style={[styles.cardTitle, { color: theme.muted }]}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  busy = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "link";
  busy?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const colors = {
    primary: { background: theme.brand, text: theme.onBrand, border: theme.brand },
    secondary: { background: theme.card, text: theme.ink, border: theme.line },
    danger: { background: theme.card, text: theme.danger, border: theme.line },
    link: { background: "transparent", text: theme.brand, border: "transparent" },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.background, borderColor: colors.border },
        (pressed || disabled || busy) && { opacity: 0.6 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Text style={[styles.buttonText, { color: colors.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  error,
  ...input
}: TextInputProps & { label: string; error?: string | null }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: theme.ink }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.muted}
        {...input}
        style={[
          styles.input,
          {
            color: theme.ink,
            backgroundColor: theme.card,
            borderColor: error ? theme.danger : theme.line,
          },
        ]}
      />
      {error ? <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}

export function Message({ text, tone = "danger" }: { text: string; tone?: "danger" | "warning" }) {
  const theme = useTheme();
  const danger = tone === "danger";
  return (
    <View
      accessibilityRole="alert"
      style={[styles.message, { backgroundColor: danger ? theme.dangerSoft : theme.warningSoft }]}
    >
      <Text style={{ color: danger ? theme.danger : theme.warning, fontSize: 14 }}>{text}</Text>
    </View>
  );
}

/** Carregando, erro com "tentar de novo", ou o conteúdo. */
export function Loadable<T>({
  data,
  error,
  loading,
  onRetry,
  children,
}: {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  onRetry: () => void;
  children: (data: T) => ReactNode;
}) {
  const theme = useTheme();
  if (data) {
    return (
      <>
        {error ? <Message text={errorText(error.code)} tone="warning" /> : null}
        {children(data)}
      </>
    );
  }
  if (loading) {
    return (
      <View style={styles.center} accessibilityLabel={t.common.loading}>
        <ActivityIndicator color={theme.brand} />
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <Message text={errorText(error?.code ?? "server")} />
      <Button label={t.common.retry} variant="secondary" onPress={onRetry} />
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  const theme = useTheme();
  return <Text style={{ color: theme.muted, fontSize: 15, paddingVertical: 8 }}>{text}</Text>;
}

/** Seta de mês anterior, nome do mês, seta de próximo. */
export function MonthSwitcher({
  label,
  onPrevious,
  onNext,
}: {
  label: string;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}) {
  const theme = useTheme();
  const arrow = (symbol: string, name: string, onPress: (() => void) | null) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ disabled: !onPress }}
      disabled={!onPress}
      onPress={onPress ?? undefined}
      hitSlop={8}
      style={[styles.arrow, { borderColor: theme.line, backgroundColor: theme.card }]}
    >
      <Text style={{ color: onPress ? theme.ink : theme.line, fontSize: 22, lineHeight: 24 }}>
        {symbol}
      </Text>
    </Pressable>
  );
  return (
    <View style={styles.monthRow}>
      {arrow("‹", t.common.previousMonth, onPrevious)}
      <Text style={[styles.monthLabel, { color: theme.ink }]}>
        {label.charAt(0).toUpperCase() + label.slice(1)}
      </Text>
      {arrow("›", t.common.nextMonth, onNext)}
    </View>
  );
}

export function EntryRow({ entry, last = false }: { entry: Entry; last?: boolean }) {
  const theme = useTheme();
  const income = entry.kind === "receita";
  const details = [entry.dateText, entry.category, entry.account].filter(Boolean).join(" · ");
  return (
    <View
      style={[styles.row, !last && { borderBottomWidth: 1, borderBottomColor: theme.line }]}
      accessible
      accessibilityLabel={`${entry.description}, ${income ? "+" : "-"}${entry.amountText}, ${details}`}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: theme.ink, fontSize: 16, fontWeight: "500" }}>
          {entry.description}
        </Text>
        <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 13 }}>
          {details}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Text
          style={{
            color: income ? theme.income : theme.ink,
            fontSize: 16,
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
          }}
        >
          {income ? "+" : "−"} {entry.amountText}
        </Text>
        {entry.status === "previsto" ? (
          <Text
            style={[styles.badge, { color: theme.warning, backgroundColor: theme.warningSoft }]}
          >
            {t.entries.planned}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Botão redondo de "novo lançamento", ao lado do título da tela. */
export function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.add,
        { backgroundColor: theme.brand },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={{ color: theme.onBrand, fontSize: 28, lineHeight: 30 }}>+</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 4 },
  cardTitle: { fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  button: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
  label: { fontSize: 14, fontWeight: "600" },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, fontSize: 16 },
  message: { borderRadius: 12, padding: 12 },
  center: { paddingVertical: 48, alignItems: "center" },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthLabel: { fontSize: 17, fontWeight: "600" },
  arrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, minHeight: 56 },
  badge: {
    fontSize: 11,
    fontWeight: "600",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
  },
  add: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
