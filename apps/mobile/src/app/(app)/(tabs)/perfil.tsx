import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, Screen } from "@/components/ui";
import { authClient } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import { useMe } from "@/lib/me";
import { t } from "@/lib/strings";
import { useTheme } from "@/lib/theme";

function LinkRow({ label, hint, onPress }: { label: string; hint?: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ color: theme.ink, fontSize: 16 }}>{label}</Text>
      {hint ? <Text style={{ color: theme.muted, fontSize: 13 }}>{hint}</Text> : null}
    </Pressable>
  );
}

export default function ProfileScreen() {
  const theme = useTheme();
  const { me, openFamily } = useMe();
  const [leaving, setLeaving] = useState(false);
  const open = (path: string) => void WebBrowser.openBrowserAsync(`${API_URL}${path}`);
  const others = me?.families.filter((family) => family.id !== me.family?.id && !family.suspended);

  return (
    <Screen title={t.profile.title}>
      <Card>
        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: "700" }}>{me?.user.name}</Text>
        <Text style={{ color: theme.muted, fontSize: 15 }}>{me?.user.email}</Text>
      </Card>
      <Card title={t.profile.family}>
        <Text style={{ color: theme.ink, fontSize: 17, fontWeight: "600", paddingVertical: 6 }}>
          {me?.family?.name}
        </Text>
        {others && others.length > 0 ? (
          <View style={{ gap: 8, paddingTop: 4 }}>
            <Text style={{ color: theme.muted, fontSize: 13 }}>{t.profile.switchFamily}</Text>
            {others.map((family) => (
              <Button
                key={family.id}
                label={family.name}
                variant="secondary"
                onPress={() => void openFamily(family.id)}
              />
            ))}
          </View>
        ) : null}
      </Card>
      <Card>
        <LinkRow
          label={t.profile.fullVersion}
          hint={t.profile.fullVersionHint}
          onPress={() => open("/app")}
        />
        <LinkRow label={t.profile.privacy} onPress={() => open("/privacidade")} />
        <LinkRow label={t.profile.terms} onPress={() => open("/termos")} />
        <LinkRow
          label={t.profile.deleteAccount}
          hint={t.profile.deleteHint}
          onPress={() => open("/app/configuracoes")}
        />
      </Card>
      <Button
        label={t.profile.signOut}
        variant="danger"
        busy={leaving}
        onPress={() => {
          setLeaving(true);
          void authClient.signOut().finally(() => setLeaving(false));
        }}
      />
      <Text style={{ color: theme.muted, fontSize: 13, textAlign: "center" }}>
        {t.profile.version} {Constants.expoConfig?.version ?? ""}
      </Text>
    </Screen>
  );
}
