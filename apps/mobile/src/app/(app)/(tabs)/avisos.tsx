import { useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, Empty, Loadable, Message, Screen } from "@/components/ui";
import { ApiError, apiPost, type Notifications } from "@/lib/api";
import { useFamily } from "@/lib/me";
import { errorText, t } from "@/lib/strings";
import { useTheme } from "@/lib/theme";
import { useApi } from "@/lib/use-api";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

export default function NoticesScreen() {
  const theme = useTheme();
  const family = useFamily();
  const notices = useApi<Notifications>("/notifications");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const unread = notices.data?.items.some((item) => !item.read) ?? false;

  async function markAll() {
    setBusy(true);
    setFailure(null);
    try {
      await apiPost("/notifications", {});
      await notices.refresh();
    } catch (caught) {
      setFailure(errorText(caught instanceof ApiError ? caught.code : "server"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={t.notices.title} refreshing={notices.refreshing} onRefresh={notices.refresh}>
      {failure ? <Message text={failure} /> : null}
      <Loadable {...notices} onRetry={notices.refresh}>
        {(data) => (
          <>
            {unread && family.canWrite ? (
              <Button label={t.notices.markAll} variant="secondary" onPress={markAll} busy={busy} />
            ) : null}
            {data.items.length === 0 ? (
              <Card>
                <Empty text={t.notices.empty} />
              </Card>
            ) : (
              data.items.map((item) => (
                <Card key={item.id}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {!item.read ? (
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: theme.brand,
                        }}
                      />
                    ) : null}
                    <Text style={{ flex: 1, color: theme.ink, fontSize: 16, fontWeight: "600" }}>
                      {item.title}
                    </Text>
                    <Text style={{ color: theme.muted, fontSize: 13 }}>{when(item.createdAt)}</Text>
                  </View>
                  <Text style={{ color: theme.muted, fontSize: 15, lineHeight: 21 }}>
                    {item.body}
                  </Text>
                </Card>
              ))
            )}
          </>
        )}
      </Loadable>
    </Screen>
  );
}
