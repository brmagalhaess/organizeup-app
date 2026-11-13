"use client";
import { OwnerField, ownerOf, type OwnerChoices } from "@/components/owner-field";
import { PersonDot } from "@/components/person";
import {
  Archive,
  ArrowLeftRight,
  ArchiveRestore,
  Banknote,
  Landmark,
  Pencil,
  PiggyBank,
  Plus,
  TrendingUp,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import {
  CURRENCIES,
  currencySymbol,
  convertMoney,
  isForeign,
  type Currency,
  type FxRates,
} from "@organizeup/domain";
import {
  Button,
  Card,
  Field,
  FormMessage,
  IconButton,
  Input,
  Select,
  Sheet,
} from "@/components/ui";
import { toAmountInput } from "@/i18n/format";
import { systemTextOf } from "@/i18n/system-text";
import { saveAccount, setAccountArchived, type SimpleFormState } from "./actions";
import { TransferForm, TransferList, type TransferRow } from "./transfers";
import { useFamilyCurrency, useMoney } from "@/i18n/money";

const TYPES = {
  corrente: Landmark,
  poupanca: PiggyBank,
  dinheiro: Banknote,
  investimento: TrendingUp,
} as const;

export interface AccountRow {
  id: string;
  name: string;
  type: keyof typeof TYPES;
  currency: Currency;
  openingBalance: string;
  /** Na moeda da conta. */
  nativeBalance: string;
  /** Na moeda principal, pela última cotação. */
  balance: string;
  archived: boolean;
}

const initial: SimpleFormState = { ok: false, message: null };
const TYPE_KEYS = ["corrente", "poupanca", "dinheiro", "investimento"] as const;

function AccountForm({
  account,
  moved,
  owners,
  onDone,
}: {
  account: AccountRow | null;
  moved: boolean;
  owners: OwnerChoices;
  onDone: () => void;
}) {
  const t = useTranslations("contas");
  const tCommon = useTranslations("common");
  const system = systemTextOf(useTranslations("sistema"));
  const locale = useLocale();
  const [state, action, pending] = useActionState(saveAccount, initial);
  const main = useFamilyCurrency();
  const [currency, setCurrency] = useState<Currency>(account?.currency ?? main);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={account?.id ?? ""} />
      <Field label={t("form.name")}>
        <Input
          name="name"
          required
          maxLength={80}
          placeholder={t("form.nameExample")}
          defaultValue={account ? system.name(account.name) : undefined}
        />
      </Field>
      <Field label={t("form.type")}>
        <Select name="type" defaultValue={account?.type ?? "corrente"}>
          {TYPE_KEYS.map((value) => (
            <option key={value} value={value}>
              {t(`types.${value}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={t("form.currency")}
        hint={t(moved ? "form.currencyLocked" : "form.currencyHint")}
      >
        <Select
          name="currency"
          value={currency}
          disabled={moved}
          onChange={(event) => setCurrency(event.target.value as Currency)}
        >
          {CURRENCIES.map((value) => (
            <option key={value} value={value}>
              {t(`currencies.${value}`)}
            </option>
          ))}
        </Select>
      </Field>
      {moved ? <input type="hidden" name="currency" value={currency} /> : null}
      <Field
        label={t("form.openingBalance", { symbol: currencySymbol(currency) })}
        hint={t("form.openingBalanceHint")}
      >
        <Input
          name="openingBalance"
          inputMode="decimal"
          placeholder={toAmountInput("0.00", locale)}
          defaultValue={account ? toAmountInput(account.openingBalance, locale) : undefined}
        />
      </Field>
      <OwnerField owners={owners} target="accounts" id={account?.id} />
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("form.save")}
      </Button>
    </form>
  );
}

export function AccountsBoard({
  rows,
  moved,
  rates,
  transfers,
  today,
  writable,
  owners,
}: {
  owners: OwnerChoices;
  rows: AccountRow[];
  moved: string[];
  rates: FxRates;
  transfers: TransferRow[];
  today: string;
  writable: boolean;
}) {
  const t = useTranslations("contas");
  const system = systemTextOf(useTranslations("sistema"));
  const moneyText = useMoney();
  const main = useFamilyCurrency();
  const [moving, setMoving] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ nonce: number; account: AccountRow | null } | null>(
    null,
  );
  const active = rows.filter((row) => !row.archived);
  const archived = rows.filter((row) => row.archived);
  const close = () => setEditing(null);
  const open = (account: AccountRow | null) =>
    setEditing((s) => ({ nonce: (s?.nonce ?? 0) + 1, account }));

  return (
    <>
      {writable && active.length >= 2 ? (
        <div>
          <Button variant="secondary" onClick={() => setMoving((n) => (n ?? 0) + 1)}>
            <ArrowLeftRight className="size-4" aria-hidden="true" />
            {t("actions.transfer")}
          </Button>
        </div>
      ) : null}
      <ul
        aria-label={t("listLabel")}
        className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
      >
        {active.map((account) => {
          const Icon = TYPES[account.type];
          const { name } = account;
          return (
            <li
              key={account.id}
              className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-5 shadow-card"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{system.name(account.name)}</p>
                    <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                      <span className="shrink-0">{t(`types.${account.type}`)}</span>
                      {ownerOf(owners, "accounts", account.id) ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <PersonDot
                            name={ownerOf(owners, "accounts", account.id)!.name}
                            slot={ownerOf(owners, "accounts", account.id)!.slot}
                          />
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>
                {writable ? (
                  <div className="flex shrink-0">
                    <IconButton label={t("actions.edit", { name })} onClick={() => open(account)}>
                      <Pencil className="size-4" aria-hidden="true" />
                    </IconButton>
                    {active.length > 1 ? (
                      <form action={setAccountArchived}>
                        <input type="hidden" name="id" value={account.id} />
                        <input type="hidden" name="archived" value="true" />
                        <IconButton type="submit" label={t("actions.archive", { name })}>
                          <Archive className="size-4" aria-hidden="true" />
                        </IconButton>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums tracking-tight">
                  {moneyText(account.nativeBalance, "full", account.currency)}
                </p>
                {isForeign(account.currency, main) ? (
                  <>
                    <p className="m-0 text-sm tabular-nums text-muted">
                      {convertMoney(account.nativeBalance, account.currency, main, rates)
                        ? `≈ ${moneyText(account.balance)}`
                        : t("fx.noBalanceInReais")}
                    </p>
                    <p className="m-0 mt-1 text-xs text-muted">
                      {t("fx.balanceNote", { currency: account.currency })}
                    </p>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
        {writable ? (
          <li>
            <button
              type="button"
              onClick={() => open(null)}
              className="flex h-full min-h-32 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-sm font-semibold text-muted transition hover:bg-brand-50 hover:text-ink"
            >
              <Plus className="size-4" aria-hidden="true" />
              {t("actions.new")}
            </button>
          </li>
        ) : null}
      </ul>

      {archived.length > 0 ? (
        <Card title={t("archived.title")} description={t("archived.text")}>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {archived.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate text-sm">{system.name(account.name)}</span>
                {writable ? (
                  <form action={setAccountArchived}>
                    <input type="hidden" name="id" value={account.id} />
                    <input type="hidden" name="archived" value="false" />
                    <IconButton
                      type="submit"
                      label={t("actions.restore", { name: system.name(account.name) })}
                    >
                      <ArchiveRestore className="size-4" aria-hidden="true" />
                    </IconButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <TransferList rows={transfers} writable={writable} />

      <Sheet open={moving !== null} onClose={() => setMoving(null)} title={t("actions.transfer")}>
        <TransferForm
          key={moving}
          accounts={active}
          rates={rates}
          today={today}
          onDone={() => setMoving(null)}
        />
      </Sheet>
      <Sheet
        open={editing !== null}
        onClose={close}
        title={t(editing?.account ? "sheet.edit" : "sheet.new")}
      >
        <AccountForm
          key={editing?.nonce}
          account={editing?.account ?? null}
          moved={editing?.account ? moved.includes(editing.account.id) : false}
          owners={owners}
          onDone={close}
        />
      </Sheet>
    </>
  );
}
