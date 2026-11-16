import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Field, Message } from "@/components/ui";
import { authClient } from "@/lib/auth";
import { t } from "@/lib/strings";
import { useTheme } from "@/lib/theme";

/** Segundo passo de quem ligou a verificação em duas etapas. */
export default function CodeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await authClient.twoFactor.verifyTotp({ code: code.trim() });
    setBusy(false);
    if (result.error) {
      setError(
        result.error.status === 429
          ? t.login.tooMany
          : result.error.status
            ? t.code.invalid
            : t.errors.network,
      );
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View
        style={{ flex: 1, justifyContent: "center", padding: 24, gap: 16, paddingTop: insets.top }}
      >
        <Text
          accessibilityRole="header"
          style={{ color: theme.ink, fontSize: 26, fontWeight: "700" }}
        >
          {t.code.title}
        </Text>
        <Text style={{ color: theme.muted, fontSize: 15 }}>{t.code.text}</Text>
        {error ? <Message text={error} /> : null}
        <Field
          label={t.code.label}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          onSubmitEditing={submit}
        />
        <Button
          label={t.code.submit}
          onPress={submit}
          busy={busy}
          disabled={code.trim().length < 6}
        />
        <Button label={t.code.back} variant="link" onPress={() => router.back()} />
      </View>
    </KeyboardAvoidingView>
  );
}
