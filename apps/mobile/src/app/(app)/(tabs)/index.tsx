import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AddButton, Card, Empty, EntryRow, Loadable, MonthSwitcher, Screen } from "@/components/ui";
import type { Overview } from "@/lib/api";
import { useFamily } from "@/lib/me";
import { t } from "@/lib/strings";
import { useTheme } from "@/lib/theme";
import { useApi } from "@/lib/use-api";

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.line,
        backgroundColor: theme.card,
        padding: 14,
        gap: 4,
      }}
    >
      <Text style={{ color: theme.muted, fontSize: 13 }}>{label}</Text>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={{ color, fontSize: 19, fontWeight: "700", fontVariant: ["tabular-nums"] }}
      >
        {value}
      </Text>
    </View>
  );
}

function Line({
  name,
  detail,
  value,
  negative,
}: {
  name: string;
  detail?: string;
  value: string;
  negative?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: theme.ink, fontSize: 16 }}>
          {name}
        </Text>
        {detail ? <Text style={{ color: theme.muted, fontSize: 13 }}>{detail}</Text> : null}
      </View>
      <Text
        style={{
          color: negative ? theme.expense : theme.ink,
          fontSize: 16,
          fontWeight: "600",
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export default function HomeScreen() {
  const theme = useTheme();
  const family = useFamily();
  const [month, setMonth] = useState<string | null>(null);
  const overview = useApi<Overview>(month ? `/overview?m=${month}` : "/overview");

  return (
    <Screen
      title={family.name}
      refreshing={overview.refreshing}
      onRefresh={overview.refresh}
      action={
        family.canWrite ? (
          <AddButton label={t.entries.add} onPress={() => router.push("/novo-lancamento")} />
        ) : null
      }
    >
      <Loadable {...overview} onRetry={overview.refresh}>
        {(data) => (
          <>
            <MonthSwitcher
              label={data.monthLabel}
              onPrevious={data.previous ? () => setMonth(data.previous) : null}
              onNext={data.next ? () => setMonth(data.next) : null}
            />
            <View
              style={{ borderRadius: 20, backgroundColor: theme.graphite, padding: 20, gap: 6 }}
            >
              <Text style={{ color: theme.accent, fontSize: 14, fontWeight: "600" }}>
                {data.phase === "atual" ? t.home.balance : t.home.balanceOn}
              </Text>
              <Text
                adjustsFontSizeToFit
                numberOfLines={1}
                style={{
                  color: theme.onGraphite,
                  fontSize: 36,
                  fontWeight: "700",
                  letterSpacing: -0.5,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {data.balance.text}
              </Text>
              {data.phase === "atual" ? (
                <Text style={{ color: theme.onGraphite, opacity: 0.8, fontSize: 13 }}>
                  {t.home.projected}: {data.balance.projectedText}
                </Text>
              ) : null}
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Stat
                label={t.home.received}
                value={data.summary.receivedText}
                color={theme.income}
              />
              <Stat label={t.home.spent} value={data.summary.spentText} color={theme.expense} />
            </View>
            <Card>
              <Line
                name={t.home.result}
                value={data.summary.resultText}
                negative={data.summary.resultNegative}
              />
            </Card>
            {data.fresh ? (
              <Card title={t.home.freshTitle}>
                <Empty text={t.home.freshText} />
              </Card>
            ) : null}
            {data.pending.length > 0 ? (
              <Card title={t.home.pending}>
                {data.pending.map((entry, index) => (
                  <EntryRow
                    key={entry.key}
                    entry={entry}
                    last={index === data.pending.length - 1}
                  />
                ))}
              </Card>
            ) : null}
            {data.accounts.length > 0 ? (
              <Card title={t.home.accounts}>
                {data.accounts.map((account) => (
                  <Line
                    key={account.id}
                    name={account.name}
                    value={account.balanceText}
                    negative={account.negative}
                  />
                ))}
              </Card>
            ) : null}
            {data.cards.length > 0 ? (
              <Card title={t.home.cards}>
                {data.cards.map((card) => (
                  <Line
                    key={card.id}
                    name={card.name}
                    detail={
                      card.status
                        ? `${t.home.statement} · ${t.home.cardStatus[card.status]}`
                        : t.home.statement
                    }
                    value={card.statementText}
                  />
                ))}
              </Card>
            ) : null}
            {data.recent.length > 0 ? (
              <Card title={t.home.recent}>
                {data.recent.map((entry) => (
                  <EntryRow key={entry.key} entry={entry} />
                ))}
                <Pressable
                  accessibilityRole="link"
                  onPress={() => router.navigate("/lancamentos")}
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <Text style={{ color: theme.brand, fontSize: 15, fontWeight: "600" }}>
                    {t.home.seeAll}
                  </Text>
                </Pressable>
              </Card>
            ) : null}
          </>
        )}
      </Loadable>
    </Screen>
  );
}
