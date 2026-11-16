import { Redirect, Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Message } from "@/components/ui";
import { authClient } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import { MeProvider, useMe } from "@/lib/me";
import { errorText, t } from "@/lib/strings";
import { useTheme } from "@/lib/theme";

/** Antes das abas: carregando, erro, escolher a família ou avisar que falta criar uma. */
function FamilyGate() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { me, error, loading, reload, openFamily } = useMe();

  if (me?.family) {
    return (
      <Stack screenOptions={{ contentStyle: { backgroundColor: theme.background } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="novo-lancamento"
          options={{
            presentation: "modal",
            title: t.newEntry.title,
            headerStyle: { backgroundColor: theme.background },
            headerTintColor: theme.ink,
          }}
        />
      </Stack>
    );
  }

  const frame = (children: React.ReactNode) => (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        gap: 16,
        padding: 24,
        paddingTop: insets.top + 24,
        backgroundColor: theme.background,
      }}
    >
      {children}
    </View>
  );

  if (loading) return frame(<ActivityIndicator color={theme.brand} />);
  if (!me) {
    return frame(
      <>
        <Message text={errorText(error?.code ?? "server")} />
        <Button label={t.common.retry} onPress={() => void reload()} />
        <Button
          label={t.profile.signOut}
          variant="link"
          onPress={() => void authClient.signOut()}
        />
      </>,
    );
  }
  if (me.families.length === 0) {
    return frame(
      <>
        <Text
          accessibilityRole="header"
          style={{ color: theme.ink, fontSize: 24, fontWeight: "700" }}
        >
          {t.family.noneTitle}
        </Text>
        <Text style={{ color: theme.muted, fontSize: 15 }}>{t.family.noneText}</Text>
        <Button
          label={t.family.openSite}
          onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/app/novo-household`)}
        />
        <Button label={t.family.reload} variant="secondary" onPress={() => void reload()} />
        <Button
          label={t.profile.signOut}
          variant="link"
          onPress={() => void authClient.signOut()}
        />
      </>,
    );
  }
  return frame(
    <>
      <Text
        accessibilityRole="header"
        style={{ color: theme.ink, fontSize: 24, fontWeight: "700" }}
      >
        {t.family.chooseTitle}
      </Text>
      {me.families.map((family) => (
        <Pressable
          key={family.id}
          accessibilityRole="button"
          accessibilityState={{ disabled: family.suspended }}
          disabled={family.suspended}
          onPress={() => void openFamily(family.id)}
          style={({ pressed }) => ({
            minHeight: 56,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.line,
            backgroundColor: theme.card,
            paddingHorizontal: 16,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            opacity: pressed || family.suspended ? 0.6 : 1,
          })}
        >
          <Text style={{ color: theme.ink, fontSize: 16, fontWeight: "600" }}>{family.name}</Text>
          {family.suspended ? (
            <Text style={{ color: theme.muted, fontSize: 13 }}>{t.family.suspended}</Text>
          ) : null}
        </Pressable>
      ))}
      <Button label={t.profile.signOut} variant="link" onPress={() => void authClient.signOut()} />
    </>,
  );
}

export default function AppLayout() {
  const { data: session } = authClient.useSession();
  if (!session) return <Redirect href="/entrar" />;
  return (
    <MeProvider>
      <FamilyGate />
    </MeProvider>
  );
}
