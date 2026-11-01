"use client";
import { Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { money, parseMoney } from "@organizeup/domain";
import { cx } from "@/components/styles";
import { Button, Field, FormMessage, Input, Select, submitKeeping } from "@/components/ui";
import { formatAmount, toFieldValue } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";

import { AccountField } from "./account-field";
import { addAsset, type FormState } from "./actions";

interface Asset {
  ticker: string;
  name: string;
  assetClass: "acao" | "fii" | "etf_bdr";
  close: string | null;
}

const KINDS = ["bolsa", "renda_fixa", "outro"] as const;
type Kind = (typeof KINDS)[number];

const STOCK_CLASSES = ["acao", "fii", "etf_bdr"] as const;
const OTHER_CLASSES = ["fundo", "previdencia", "exterior", "outro"] as const;

const initial: FormState = { ok: false, message: null };
const SEARCH_DELAY_MS = 200;

/** Preço do catálogo no campo, sempre com duas casas: "32,50" em português, "32.50" em inglês. */
const toInput = (value: string, locale: Locale) => toFieldValue(money(value).toFixed(2), locale);

function totalOf(quantity: string, price: string, locale: Locale): string | null {
  try {
    const total = parseMoney(quantity, locale).times(parseMoney(price, locale));
    return total.gt(0) ? formatAmount(total.toFixed(2), locale) : null;
  } catch {
    return null;
  }
}

/** Busca enquanto a pessoa digita. Falha de rede só deixa a lista vazia: o cadastro manual segue. */
function useAssetSearch(query: string) {
  const [state, setState] = useState<{ query: string; assets: Asset[] }>({ query: "", assets: [] });
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    const stop = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/ativos?q=${encodeURIComponent(term)}`, { signal: stop.signal })
        .then((response) => (response.ok ? response.json() : { assets: [] }))
        .then((body: { assets: Asset[] }) => setState({ query: term, assets: body.assets }))
        .catch(() => setState({ query: term, assets: [] }));
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      stop.abort();
    };
  }, [query]);
  const term = query.trim();
  return {
    assets: term.length >= 2 && state.query === term ? state.assets : [],
    searched: state.query === term,
  };
}

function TradeFields({ today, price }: { today: string; price: string }) {
  const t = useTranslations("investimentos");
  const locale = useLocale();
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState(price);
  const total = totalOf(quantity, unit, locale);
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("form.quantity")}>
          <Input
            name="quantity"
            inputMode="decimal"
            required
            placeholder="100"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
        <Field label={t("add.pricePaid")}>
          <Input
            name="unitPrice"
            inputMode="decimal"
            required
            placeholder={t("form.pricePlaceholder")}
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("add.purchaseDate")}>
          <Input name="occurredOn" type="date" required defaultValue={today} max={today} />
        </Field>
        <Field label={t("form.fees")} hint={t("add.feesHint")}>
          <Input name="fees" inputMode="decimal" placeholder={t("form.zeroPlaceholder")} />
        </Field>
      </div>
      <p className="m-0 text-sm text-muted">
        {total ? t("add.total", { total }) : t("add.totalEmpty")}
      </p>
    </>
  );
}

function ExchangeFields({ today }: { today: string }) {
  const t = useTranslations("investimentos");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Asset | null>(null);
  const [manual, setManual] = useState(false);
  const { assets, searched } = useAssetSearch(query);

  if (picked) {
    return (
      <>
        <input type="hidden" name="ticker" value={picked.ticker} />
        <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-card-soft p-3">
          <div className="min-w-0 text-sm">
            <p className="m-0 font-semibold">{picked.ticker}</p>
            <p className="m-0 break-words text-muted">{picked.name}</p>
            <p className="m-0 text-muted">
              {t(`add.stockClasses.${picked.assetClass}`)}
              {picked.close
                ? ` · ${t("add.today", { price: formatAmount(money(picked.close).toFixed(2), locale) })}`
                : ""}
            </p>
          </div>
          <Button type="button" variant="ghost" small onClick={() => setPicked(null)}>
            {t("add.change")}
          </Button>
        </div>
        <TradeFields today={today} price={picked.close ? toInput(picked.close, locale) : ""} />
      </>
    );
  }

  if (manual) {
    return (
      <>
        <Field label={t("form.code")} hint={t("add.codeHint")}>
          <Input name="ticker" maxLength={12} required defaultValue={query.toUpperCase()} />
        </Field>
        <Field label={t("form.name")}>
          <Input name="name" required maxLength={80} />
        </Field>
        <Field label={t("form.type")}>
          <Select name="assetClass" defaultValue="acao">
            {STOCK_CLASSES.map((value) => (
              <option key={value} value={value}>
                {t(`add.stockClasses.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <TradeFields today={today} price="" />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Field label={t("add.asset")} hint={t("add.assetHint")}>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            autoComplete="off"
            placeholder={t("add.searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </Field>
      {assets.length > 0 ? (
        <ul aria-label={t("add.found")} className="m-0 flex list-none flex-col gap-1 p-0">
          {assets.map((asset) => (
            <li key={asset.ticker}>
              <button
                type="button"
                onClick={() => setPicked(asset)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-line bg-card-soft px-3 py-2 text-left text-sm"
              >
                <span className="min-w-0">
                  <span className="block font-semibold">{asset.ticker}</span>
                  <span className="block truncate text-muted">{asset.name}</span>
                </span>
                {asset.close ? (
                  <span className="shrink-0 tabular-nums text-muted">
                    {formatAmount(money(asset.close).toFixed(2), locale)}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {searched && assets.length === 0 && query.trim().length >= 2 ? (
        <p className="m-0 text-sm text-muted">{t("add.notFound")}</p>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        small
        className="self-start"
        onClick={() => setManual(true)}
      >
        {t("add.manual")}
      </Button>
    </div>
  );
}

function ManualFields({ kind, today }: { kind: Exclude<Kind, "bolsa">; today: string }) {
  const t = useTranslations("investimentos");
  return (
    <>
      <Field label={t("form.name")}>
        <Input
          name="name"
          required
          maxLength={80}
          placeholder={t(
            kind === "renda_fixa" ? "add.namePlaceholderFixed" : "add.namePlaceholderOther",
          )}
        />
      </Field>
      {kind === "outro" ? (
        <Field label={t("form.type")}>
          <Select name="assetClass" defaultValue="fundo">
            {OTHER_CLASSES.map((value) => (
              <option key={value} value={value}>
                {t(`add.otherClasses.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="assetClass" value="renda_fixa" />
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("add.amount")}>
          <Input
            name="amount"
            inputMode="decimal"
            required
            placeholder={t("form.amountPlaceholder")}
          />
        </Field>
        <Field label={t("form.date")}>
          <Input name="occurredOn" type="date" required defaultValue={today} max={today} />
        </Field>
      </div>
      <Field label={t("add.currentValue")} hint={t("add.currentValueHint")}>
        <Input
          name="currentValue"
          inputMode="decimal"
          placeholder={t("add.currentValuePlaceholder")}
        />
      </Field>
    </>
  );
}

/** Um cadastro só: o ativo e a compra na mesma tela. Trocar o tipo limpa o que estava preenchido. */
export function AddAssetForm({
  today,
  accounts,
  onDone,
}: {
  today: string;
  accounts: Array<{ id: string; name: string }>;
  onDone: () => void;
}) {
  const t = useTranslations("investimentos");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(addAsset, initial);
  const [kind, setKind] = useState<Kind>("bolsa");
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">{t("add.kindLegend")}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {KINDS.map((option) => (
            <label
              key={option}
              className={cx(
                "flex cursor-pointer flex-col rounded-xl border p-3 text-sm has-[:focus-visible]:ring-2",
                kind === option ? "border-brand-700 bg-card-soft" : "border-line",
              )}
            >
              <input
                type="radio"
                name="kind"
                value={option}
                checked={kind === option}
                onChange={() => setKind(option)}
                className="sr-only"
              />
              <span className="font-medium">{t(`add.kinds.${option}.label`)}</span>
              <span className="text-xs text-muted">{t(`add.kinds.${option}.hint`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {kind === "bolsa" ? (
        <ExchangeFields key="bolsa" today={today} />
      ) : (
        <ManualFields key={kind} kind={kind} today={today} />
      )}
      <AccountField accounts={accounts} />
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("add.submit")}
      </Button>
    </form>
  );
}
