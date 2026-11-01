"use client";
import { ArrowRight, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import {
  currencySymbol,
  parseMoney,
  suggestTransfer,
  type Currency,
  type FxRates,
} from "@organizeup/domain";
import {
  Button,
  Card,
  ConfirmSheet,
  Field,
  FormMessage,
  IconButton,
  Input,
  Select,
} from "@/components/ui";
import { formatAmount, formatDate, toAmountInput } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { systemTextOf } from "@/i18n/system-text";
import { createTransfer, deleteTransfer, type SimpleFormState } from "./actions";

export interface TransferRow {
  id: string;
  fromName: string;
  toName: string;
  fromCurrency: Currency;
  toCurrency: Currency;
  amount: string;
  /** Null: mesma moeda, mesmo valor nas duas pontas. */
  toAmount: string | null;
  occurredOn: string;
  note: string | null;
}

const initial: SimpleFormState = { ok: false, message: null };

/** Quanto entraria pela cotação de hoje, para sugerir. Null com valor inválido ou sem cotação. */
function suggestion(typed: string, from: Currency, to: Currency, rates: FxRates, locale: Locale) {
  try {
    const value = parseMoney(typed, locale);
    return value.gt(0) ? suggestTransfer(value, from, to, rates) : null;
  } catch {
    return null;
  }
}

export function TransferForm({
  accounts,
  rates,
  today,
  onDone,
}: {
  accounts: Array<{ id: string; name: string; currency: Currency }>;
  rates: FxRates;
  today: string;
  onDone: () => void;
}) {
  const t = useTranslations("contas.transfer");
  const system = systemTextOf(useTranslations("sistema"));
  const locale = useLocale();
  const [state, action, pending] = useActionState(createTransfer, initial);
  const [fromId, setFromId] = useState(accounts[0]?.id ?? "");
  const [toId, setToId] = useState(accounts[1]?.id ?? "");
  const [typed, setTyped] = useState("");
  /** O que a pessoa escreveu em "entrou". Null: segue a sugestão. */
  const [received, setReceived] = useState<string | null>(null);
  const from = accounts.find((account) => account.id === fromId)?.currency ?? "BRL";
  const to = accounts.find((account) => account.id === toId)?.currency ?? "BRL";
  const exchange = from !== to;
  const suggested = exchange ? suggestion(typed, from, to, rates, locale) : null;
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("from")}>
          <Select
            name="fromAccountId"
            value={fromId}
            onChange={(event) => setFromId(event.target.value)}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {system.name(account.name)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("to")}>
          <Select name="toAccountId" value={toId} onChange={(event) => setToId(event.target.value)}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {system.name(account.name)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t(exchange ? "left" : "amount", { symbol: currencySymbol(from) })}>
          <Input
            name="amount"
            inputMode="decimal"
            required
            placeholder={toAmountInput("500.00", locale)}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </Field>
        {exchange ? (
          <Field label={t("entered", { symbol: currencySymbol(to) })} hint={t("enteredHint")}>
            <Input
              name="toAmount"
              inputMode="decimal"
              required
              placeholder={toAmountInput("500.00", locale)}
              value={received ?? (suggested ? toAmountInput(suggested, locale) : "")}
              onChange={(event) => setReceived(event.target.value)}
            />
          </Field>
        ) : null}
        <Field label={t("date")}>
          <Input name="occurredOn" type="date" required defaultValue={today} />
        </Field>
      </div>
      <Field label={t("note")} hint={t("noteHint")}>
        <Input name="note" maxLength={120} />
      </Field>
      <p className="m-0 text-xs text-muted">{t(exchange ? "explainExchange" : "explain")}</p>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {t(pending ? "pending" : "submit")}
      </Button>
    </form>
  );
}

export function TransferList({ rows, writable }: { rows: TransferRow[]; writable: boolean }) {
  const t = useTranslations("contas.transfer");
  const system = systemTextOf(useTranslations("sistema"));
  const locale = useLocale();
  const [removing, setRemoving] = useState<TransferRow | null>(null);
  if (rows.length === 0) return null;
  return (
    <Card title={t("recent")}>
      <ul aria-label={t("list")} className="m-0 list-none divide-y divide-line p-0">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="m-0 flex flex-wrap items-center gap-1 font-medium">
                {system.name(row.fromName)}
                <ArrowRight className="size-3.5" aria-label={t("arrow")} />
                {system.name(row.toName)}
              </p>
              <p className="m-0 break-words text-xs text-muted">
                {formatDate(row.occurredOn, locale)}
                {row.note ? ` · ${row.note}` : ""}
              </p>
            </div>
            <p className="m-0 whitespace-nowrap text-right font-medium tabular-nums">
              {formatAmount(row.amount, locale, "full", row.fromCurrency)}
              {row.toAmount ? (
                <span className="block text-xs font-normal text-muted">
                  {t("received", {
                    value: formatAmount(row.toAmount, locale, "full", row.toCurrency),
                  })}
                </span>
              ) : null}
            </p>
            {writable ? (
              <IconButton label={t("undo")} onClick={() => setRemoving(row)}>
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            ) : null}
          </li>
        ))}
      </ul>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("undo")}
        text={t("undoText")}
        confirmLabel={t("undoConfirm")}
        action={deleteTransfer}
        hidden={{ id: removing?.id ?? "" }}
      />
    </Card>
  );
}
