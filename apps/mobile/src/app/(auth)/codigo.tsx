import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Field, Message } from "@/components/ui";
import { authClient } from "@/lib/auth";
import { t } from "@/lib/strings";
import { useTheme } from "@/lib/theme";

type Failure = { status?: number; code?: string };

function failureText(error: Failure): string {
  if (error.status === 429 || error.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE") {
    return t.login.tooMany;
  }
  if (error.code === "INVALID_TWO_FACTOR_COOKIE") return t.code.expired;
  return error.status ? t.code.invalid : t.errors.network;
}

/**
 * Segundo passo de quem ligou a verificação em duas etapas (ADR-0034): o código do autenticador ou,
 * como no site, um código de reserva. Com o código certo a sessão nasce e o app abre sozinho.
 */
export default function CodeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clean = code.replace(/\s+/g, "");
  const ready = backup ? clean.length >= 8 : clean.length === 6;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const result = backup
      ? await authClient.twoFactor.verifyBackupCode({ code: clean })
      : await authClient.twoFactor.verifyTotp({ code: clean });
    setBusy(false);
    if (result.error) setError(failureText(result.error));
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
          gap: 16,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ color: theme.ink, fontSize: 26, fontWeight: "700" }}
        >
          {backup ? t.code.backupTitle : t.code.title}
        </Text>
        <Text style={{ color: theme.muted, fontSize: 15 }}>
          {backup ? t.code.backupText : t.code.text}
        </Text>
        {error ? <Message text={error} /> : null}
        <Field
          key={backup ? "backup" : "totp"}
          label={backup ? t.code.backupLabel : t.code.label}
          value={code}
          onChangeText={setCode}
          keyboardType={backup ? "default" : "number-pad"}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={backup ? 16 : 6}
          autoFocus
          onSubmitEditing={submit}
          testID="code"
        />
        <Button label={t.code.submit} onPress={submit} busy={busy} disabled={!ready} />
        <Button
          label={backup ? t.code.useApp : t.code.useBackup}
          variant="link"
          onPress={() => {
            setBackup((value) => !value);
            setCode("");
            setError(null);
          }}
        />
        <Button label={t.code.back} variant="link" onPress={() => router.back()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
