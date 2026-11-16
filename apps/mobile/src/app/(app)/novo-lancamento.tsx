import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { router } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Field, Loadable, Message } from "@/components/ui";
import { ApiError, apiPost, type MonthEntries } from "@/lib/api";
import { fromIsoDate, toIsoDate } from "@/lib/months";
import { errorText, t } from "@/lib/strings";
import { useTheme } from "@/lib/theme";
import { useApi } from "@/lib/use-api";

type Kind = "despesa" | "receita";

function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label: string;
  options: { id: T; name: string }[];
  value: T | null;
  onChange: (id: T) => void;
  error?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={{ color: theme.ink, fontSize: 14, fontWeight: "600" }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.id)}
              style={{
                minHeight: 44,
                justifyContent: "center",
                paddingHorizontal: 14,
                borderRadius: 22,
                borderWidth: 1,
                borderColor: selected ? theme.brand : theme.line,
                backgroundColor: selected ? theme.brand : theme.card,
              }}
            >
              <Text style={{ color: selected ? theme.onBrand : theme.ink, fontSize: 15 }}>
                {option.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}

function Form({ data }: { data: MonthEntries }) {
  const theme = useTheme();
  const [kind, setKind] = useState<Kind>("despesa");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => fromIsoDate(data.today));
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(data.accounts[0]?.id ?? null);
  const [done, setDone] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const categories = data.categories.filter((category) => category.kind === kind);

  async function submit() {
    setBusy(true);
    setMessage(null);
    setErrors({});
    try {
      await apiPost("/entries", {
        kind,
        description,
        amount,
        date: toIsoDate(date),
        categoryId: categoryId ?? "",
        accountId: accountId ?? "",
        done,
      });
      router.back();
    } catch (caught) {
      const failure = caught instanceof ApiError ? caught : new ApiError("server", 0);
      setErrors(failure.fieldErrors);
      setMessage(
        failure.code === "invalid"
          ? (failure.message ?? t.newEntry.failed)
          : errorText(failure.code),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {message ? <Message text={message} /> : null}
      <Chips
        label={t.newEntry.kind}
        options={[
          { id: "despesa", name: t.newEntry.expense },
          { id: "receita", name: t.newEntry.income },
        ]}
        value={kind}
        onChange={(next) => {
          setKind(next);
          setCategoryId(null);
        }}
      />
      <Field
        label={t.newEntry.amount}
        value={amount}
        onChangeText={setAmount}
        placeholder={t.newEntry.amountHint}
        keyboardType="decimal-pad"
        error={errors.amount}
        testID="amount"
      />
      <Field
        label={t.newEntry.description}
        value={description}
        onChangeText={setDescription}
        placeholder={t.newEntry.descriptionHint}
        maxLength={120}
        error={errors.description}
        testID="description"
      />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: theme.ink, fontSize: 14, fontWeight: "600" }}>{t.newEntry.date}</Text>
        {Platform.OS === "ios" ? (
          <DateTimePicker
            value={date}
            mode="date"
            display="compact"
            locale="pt-BR"
            onValueChange={(_event, next) => setDate(next)}
          />
        ) : (
          <Button
            label={date.toLocaleDateString("pt-BR")}
            variant="secondary"
            onPress={() =>
              DateTimePickerAndroid.open({
                value: date,
                mode: "date",
                onValueChange: (_event, next) => setDate(next),
              })
            }
          />
        )}
      </View>
      {errors.date ? (
        <Text style={{ color: theme.danger, fontSize: 13 }}>{errors.date}</Text>
      ) : null}
      <Chips
        label={t.newEntry.category}
        options={categories}
        value={categoryId}
        onChange={setCategoryId}
        error={errors.categoryId}
      />
      <Chips
        label={t.newEntry.account}
        options={data.accounts}
        value={accountId}
        onChange={setAccountId}
        error={errors.accountId}
      />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: theme.ink, fontSize: 16 }}>
          {kind === "despesa" ? t.newEntry.donePaid : t.newEntry.doneReceived}
        </Text>
        <Switch
          value={done}
          onValueChange={setDone}
          trackColor={{ true: theme.brand }}
          accessibilityLabel={kind === "despesa" ? t.newEntry.donePaid : t.newEntry.doneReceived}
        />
      </View>
      <Button label={t.common.save} onPress={submit} busy={busy} />
      <Button label={t.common.cancel} variant="link" onPress={() => router.back()} />
    </>
  );
}

export default function NewEntryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const options = useApi<MonthEntries>("/entries");
  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <Loadable {...options} onRetry={options.refresh}>
        {(data) => <Form data={data} />}
      </Loadable>
    </ScrollView>
  );
}
