"use client";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import {
  CARD_CATEGORY,
  currencySymbol,
  isForeign,
  parseMoney,
  toMain,
  type Currency,
  type FxQuote,
  type MonthEntry,
} from "@organizeup/domain";
import {
  quoteForEntry,
  saveEntry,
  type EntryFormState,
} from "@/app/app/(painel)/lancamentos/actions";
import { cx } from "@/components/styles";
import { Button, Field, FormMessage, Input, Select } from "@/components/ui";
import { formatDate, toAmountInput } from "@/i18n/format";
import { systemTextOf } from "@/i18n/system-text";
import { useFamilyCurrency, useMoney } from "@/i18n/money";

const initial: EntryFormState = { ok: false, message: null };

export interface EntryOptions {
  accounts: Array<{ id: string; name: string; archived: boolean; currency: Currency }>;
  categories: Array<{ id: string; name: string; kind: "receita" | "despesa"; archived: boolean }>;
  cards: Array<{ id: string; name: string }>;
}

export type EditableEntry = Pick<
  MonthEntry,
  | "key"
  | "kind"
  | "description"
  | "amount"
  | "date"
  | "status"
  | "categoryId"
  | "accountId"
  | "source"
  | "originalAmount"
>;

/** "≈ 542,12 na moeda principal, cotação de 30/10/2026", enquanto a pessoa digita em outra moeda. */
function FxPreview({ currency, date, typed }: { currency: Currency; date: string; typed: string }) {
  const t = useTranslations("lancamentos.form");
  const locale = useLocale();
  const moneyText = useMoney();
  const asked = `${currency}|${date}`;
  const [found, setFound] = useState<{ asked: string; quote: FxQuote | null } | null>(null);
  useEffect(() => {
    let current = true;
    quoteForEntry(currency, date)
      .then((quote) => {
        if (current) setFound({ asked: `${currency}|${date}`, quote });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [currency, date]);
  if (found?.asked !== asked) return null;
  if (!found.quote)
    return (
      <p className="m-0 text-xs text-warning" role="status">
        {t("noQuote")}
      </p>
    );
  let value: string | null = null;
  try {
    const parsed = parseMoney(typed, locale);
    if (parsed.gt(0)) value = toMain(parsed, found.quote.rate);
  } catch {
    value = null;
  }
  const quoted = formatDate(found.quote.date, locale);
  return (
    <p className="m-0 text-xs text-muted" role="status">
      {value
        ? t("fxPreview", { value: moneyText(value), date: quoted })
        : t("fxRate", { date: quoted })}
    </p>
  );
}

export function EntryForm({
  today,
  options,
  initialKind,
  initialCard,
  entry,
  onDone,
}: {
  today: string;
  options: EntryOptions;
  initialKind: "receita" | "despesa";
  initialCard: string | null;
  entry: EditableEntry | null;
  onDone: () => void;
}) {
  const t = useTranslations("lancamentos.form");
  const tCommon = useTranslations("common");
  const system = systemTextOf(useTranslations("sistema"));
  const locale = useLocale();
  const [state, action, pending] = useActionState(saveEntry, initial);
  const [kind, setKind] = useState(initialKind);
  const [paidWith, setPaidWith] = useState(
    initialCard ? `card:${initialCard}` : (entry?.accountId ?? options.accounts[0]?.id ?? ""),
  );
  const startValue = entry?.originalAmount ?? entry?.amount;
  const [typed, setTyped] = useState(startValue ? toAmountInput(startValue, locale) : "");
  const [date, setDate] = useState(entry?.date ?? today);
  const isPlan = entry?.source === "previsao";
  const showCards = !entry && kind === "despesa" && options.cards.length > 0;
  const onCard = showCards && paidWith.startsWith("card:");
  const main = useFamilyCurrency();
  const currency = options.accounts.find((account) => account.id === paidWith)?.currency ?? main;
  const foreign = isForeign(currency, main);

  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="flex flex-col gap-4">
      {entry ? <input type="hidden" name="key" value={entry.key} /> : null}
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">{t("type")}</legend>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-brand-50 p-1">
          {(
            [
              ["despesa", t("expense")],
              ["receita", t("income")],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={cx(
                "flex min-h-10 cursor-pointer items-center justify-center rounded-lg text-sm font-semibold has-focus-visible:outline-2 has-focus-visible:outline-brand-500",
                kind === value ? "bg-card text-ink shadow-sm" : "text-muted",
              )}
            >
              <input
                type="radio"
                name="kind"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <Field label={t("description")} error={state.fieldErrors?.description}>
        <Input
          name="description"
          required
          maxLength={120}
          placeholder={t(kind === "despesa" ? "expenseExample" : "incomeExample")}
          defaultValue={entry?.description}
        />
      </Field>
      <div className="grid grid-cols-[2fr_3fr] gap-3">
        <Field
          label={t("amount", { symbol: currencySymbol(currency) })}
          error={state.fieldErrors?.amount}
        >
          <Input
            name="amount"
            inputMode="decimal"
            required
            placeholder={toAmountInput("0.00", locale)}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </Field>
        <Field label={t("date")} error={state.fieldErrors?.date}>
          <Input
            name="date"
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
      </div>
      {foreign ? <FxPreview currency={currency} date={date} typed={typed} /> : null}
      <Field label={t("category")} error={state.fieldErrors?.categoryId}>
        <Select
          name="categoryId"
          required
          key={kind}
          defaultValue={kind === entry?.kind ? entry.categoryId : undefined}
        >
          {options.categories
            .filter(
              (c) =>
                c.kind === kind &&
                (c.id === entry?.categoryId || (!c.archived && c.name !== CARD_CATEGORY)),
            )
            .map((category) => (
              <option key={category.id} value={category.id}>
                {system.name(category.name)}
              </option>
            ))}
        </Select>
      </Field>
      <Field
        label={t(showCards ? "accountOrCard" : "account")}
        error={state.fieldErrors?.accountId}
      >
        <Select
          name="accountId"
          required
          value={paidWith}
          onChange={(event) => setPaidWith(event.target.value)}
        >
          {options.accounts
            .filter((a) => !a.archived || a.id === entry?.accountId)
            .map((account) => (
              <option key={account.id} value={account.id}>
                {system.name(account.name)}
              </option>
            ))}
          {showCards ? (
            <optgroup label={t("cards")}>
              {options.cards.map((card) => (
                <option key={card.id} value={`card:${card.id}`}>
                  {card.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </Select>
      </Field>
      {onCard ? (
        <Field
          label={t("installments")}
          hint={t("installmentsHint")}
          error={state.fieldErrors?.installments}
        >
          <Input name="installments" type="number" min={1} max={72} required defaultValue={1} />
        </Field>
      ) : null}

      {!isPlan && !onCard ? (
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="done"
            defaultChecked={entry ? entry.status === "realizado" : true}
            className="size-5 accent-brand-500"
          />
          {t(kind === "despesa" ? "paid" : "received")}
        </label>
      ) : null}
      {!entry && !onCard && !foreign ? (
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" name="repeat" className="size-5 accent-brand-500" />
          {t("repeat")}
        </label>
      ) : null}
      {isPlan ? (
        <p className="rounded-xl bg-brand-50 p-3 text-sm text-muted">{t("planNotice")}</p>
      ) : null}

      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t(entry ? "saveChanges" : "save")}
      </Button>
    </form>
  );
}
