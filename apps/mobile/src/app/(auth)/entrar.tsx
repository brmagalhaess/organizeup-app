import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import icon from "@/assets/images/icon.png";
import { Button, Field, Message } from "@/components/ui";
import { authClient } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import { t } from "@/lib/strings";
import { useTheme } from "@/lib/theme";

function failureText(error: { status?: number; message?: string }): string {
  if (error.status === 429) return t.login.tooMany;
  if (error.message === "ACCOUNT_BLOCKED") return t.errors.blocked;
  if (error.message === "MAINTENANCE") return t.login.maintenance;
  if (!error.status) return t.errors.network;
  return error.status >= 500 ? t.errors.server : t.login.invalid;
}

export default function SignInScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim() || !password) {
      setError(t.login.missing);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (result.error) {
      setError(failureText(result.error));
      return;
    }
    // Com a verificação em duas etapas ligada, a sessão só nasce depois do código (ADR-0034).
    if ((result.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      router.push("/codigo");
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 24,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          gap: 16,
        }}
      >
        <View style={{ alignItems: "center", gap: 12, marginBottom: 8 }}>
          <Image
            source={icon}
            accessibilityIgnoresInvertColors
            style={{ width: 72, height: 72, borderRadius: 18 }}
          />
          <Text
            accessibilityRole="header"
            style={{ color: theme.ink, fontSize: 30, fontWeight: "700", letterSpacing: -0.5 }}
          >
            Organize<Text style={{ color: theme.brand }}>Up</Text>
          </Text>
          <Text style={{ color: theme.muted, fontSize: 15, textAlign: "center" }}>
            {t.login.tagline}
          </Text>
        </View>
        {error ? <Message text={error} /> : null}
        <Field
          label={t.login.email}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
          testID="email"
        />
        <Field
          label={t.login.password}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          testID="password"
        />
        <Button label={t.login.submit} onPress={submit} busy={busy} />
        <Button
          label={t.login.forgot}
          variant="link"
          onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/esqueci-senha`)}
        />
        <Button
          label={t.login.signUp}
          variant="secondary"
          onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/cadastro`)}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
