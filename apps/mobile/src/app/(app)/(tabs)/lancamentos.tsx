import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { AddButton, Card, Empty, EntryRow, Loadable, MonthSwitcher, Screen } from "@/components/ui";
import type { MonthEntries } from "@/lib/api";
import { addMonths } from "@/lib/months";
import { t } from "@/lib/strings";
import { useTheme } from "@/lib/theme";
import { useApi } from "@/lib/use-api";

export default function EntriesScreen() {
  const theme = useTheme();
  const [month, setMonth] = useState<string | null>(null);
  const entries = useApi<MonthEntries>(month ? `/entries?m=${month}` : "/entries");
  const canWrite = entries.data?.canWrite ?? false;

  return (
    <Screen
      title={t.entries.title}
      refreshing={entries.refreshing}
      onRefresh={entries.refresh}
      action={
        canWrite ? (
          <AddButton label={t.entries.add} onPress={() => router.push("/novo-lancamento")} />
        ) : null
      }
    >
      <Loadable {...entries} onRetry={entries.refresh}>
        {(data) => (
          <>
            <MonthSwitcher
              label={data.monthLabel}
              onPrevious={() => setMonth(addMonths(data.month, -1))}
              onNext={() => setMonth(addMonths(data.month, 1))}
            />
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <View style={{ gap: 2 }}>
                  <Text style={{ color: theme.muted, fontSize: 13 }}>{t.home.received}</Text>
                  <Text style={{ color: theme.income, fontSize: 16, fontWeight: "600" }}>
                    {data.summary.receivedText}
                  </Text>
                </View>
                <View style={{ gap: 2, alignItems: "center" }}>
                  <Text style={{ color: theme.muted, fontSize: 13 }}>{t.home.spent}</Text>
                  <Text style={{ color: theme.expense, fontSize: 16, fontWeight: "600" }}>
                    {data.summary.spentText}
                  </Text>
                </View>
                <View style={{ gap: 2, alignItems: "flex-end" }}>
                  <Text style={{ color: theme.muted, fontSize: 13 }}>{t.home.result}</Text>
                  <Text
                    style={{
                      color: data.summary.resultNegative ? theme.expense : theme.ink,
                      fontSize: 16,
                      fontWeight: "600",
                    }}
                  >
                    {data.summary.resultText}
                  </Text>
                </View>
              </View>
            </Card>
            <Card>
              {data.entries.length === 0 ? (
                <Empty text={t.entries.empty} />
              ) : (
                data.entries.map((entry, index) => (
                  <EntryRow
                    key={entry.key}
                    entry={entry}
                    last={index === data.entries.length - 1}
                  />
                ))
              )}
            </Card>
          </>
        )}
      </Loadable>
    </Screen>
  );
}
