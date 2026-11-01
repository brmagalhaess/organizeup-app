"use client";
import { Search } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { formatBRL, money, parseBRL } from "@organizeup/domain";
import { cx } from "@/components/styles";
import { Button, Field, FormMessage, Input, Select, submitKeeping } from "@/components/ui";

import { AccountField } from "./account-field";
import { addAsset, type FormState } from "./actions";

interface Asset {
  ticker: string;
  name: string;
  assetClass: "acao" | "fii" | "etf_bdr";
  close: string | null;
}

const KINDS = [
  { value: "bolsa", label: "Na bolsa", hint: "Ações, fundos imobiliários, ETFs e BDRs" },
  { value: "renda_fixa", label: "Renda fixa", hint: "CDB, Tesouro, LCI, LCA" },
  { value: "outro", label: "Outro", hint: "Fundos, previdência e exterior" },
] as const;
type Kind = (typeof KINDS)[number]["value"];

const STOCK_LABEL: Record<string, string> = {
  acao: "Ação",
  fii: "Fundo imobiliário",
  etf_bdr: "ETF ou BDR",
};

const OTHER_CLASSES = [
  ["fundo", "Fundo de investimento"],
  ["previdencia", "Previdência"],
  ["exterior", "Exterior"],
  ["outro", "Outro"],
] as const;

const initial: FormState = { ok: false, message: null };
const SEARCH_DELAY_MS = 200;

const toInput = (value: string) => money(value).toFixed(2).replace(".", ",");

function totalOf(quantity: string, price: string): string | null {
  try {
    const total = parseBRL(quantity).times(parseBRL(price));
    return total.gt(0) ? formatBRL(total.toFixed(2)) : null;
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
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState(price);
  const total = totalOf(quantity, unit);
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantidade">
          <Input
            name="quantity"
            inputMode="decimal"
            required
            placeholder="100"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
        <Field label="Preço pago (R$)">
          <Input
            name="unitPrice"
            inputMode="decimal"
            required
            placeholder="32,50"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data da compra">
          <Input name="occurredOn" type="date" required defaultValue={today} max={today} />
        </Field>
        <Field label="Taxas (R$)" hint="Opcional.">
          <Input name="fees" inputMode="decimal" placeholder="0,00" />
        </Field>
      </div>
      <p className="m-0 text-sm text-muted">
        {total ? `Total da compra: ${total}` : "O total aparece aqui."}
      </p>
    </>
  );
}

function ExchangeFields({ today }: { today: string }) {
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
              {STOCK_LABEL[picked.assetClass]}
              {picked.close ? ` · hoje ${formatBRL(money(picked.close).toFixed(2))}` : ""}
            </p>
          </div>
          <Button type="button" variant="ghost" small onClick={() => setPicked(null)}>
            Trocar
          </Button>
        </div>
        <TradeFields today={today} price={picked.close ? toInput(picked.close) : ""} />
      </>
    );
  }

  if (manual) {
    return (
      <>
        <Field label="Código" hint="Ex.: PETR4, HGLG11.">
          <Input name="ticker" maxLength={12} required defaultValue={query.toUpperCase()} />
        </Field>
        <Field label="Nome">
          <Input name="name" required maxLength={80} />
        </Field>
        <Field label="Tipo">
          <Select name="assetClass" defaultValue="acao">
            {Object.entries(STOCK_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
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
      <Field label="Ativo" hint="Digite o código ou o nome. Nome, tipo e preço vêm sozinhos.">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            autoComplete="off"
            placeholder="PETR4, Itaú, HGLG11"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </Field>
      {assets.length > 0 ? (
        <ul aria-label="Ativos encontrados" className="m-0 flex list-none flex-col gap-1 p-0">
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
                    {formatBRL(money(asset.close).toFixed(2))}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {searched && assets.length === 0 && query.trim().length >= 2 ? (
        <p className="m-0 text-sm text-muted">Não achei esse ativo no catálogo.</p>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        small
        className="self-start"
        onClick={() => setManual(true)}
      >
        Preencher à mão
      </Button>
    </div>
  );
}

function ManualFields({ kind, today }: { kind: Exclude<Kind, "bolsa">; today: string }) {
  return (
    <>
      <Field label="Nome">
        <Input
          name="name"
          required
          maxLength={80}
          placeholder={
            kind === "renda_fixa" ? "Ex.: Tesouro Selic 2031" : "Ex.: Previdência da empresa"
          }
        />
      </Field>
      {kind === "outro" ? (
        <Field label="Tipo">
          <Select name="assetClass" defaultValue="fundo">
            {OTHER_CLASSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="assetClass" value="renda_fixa" />
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor aplicado (R$)">
          <Input name="amount" inputMode="decimal" required placeholder="1.000,00" />
        </Field>
        <Field label="Data">
          <Input name="occurredOn" type="date" required defaultValue={today} max={today} />
        </Field>
      </div>
      <Field label="Valor hoje (R$)" hint="Opcional. Sem ele, usamos o valor aplicado.">
        <Input name="currentValue" inputMode="decimal" placeholder="1.050,00" />
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
  const [state, action, pending] = useActionState(addAsset, initial);
  const [kind, setKind] = useState<Kind>("bolsa");
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Onde está esse investimento?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {KINDS.map((option) => (
            <label
              key={option.value}
              className={cx(
                "flex cursor-pointer flex-col rounded-xl border p-3 text-sm has-[:focus-visible]:ring-2",
                kind === option.value ? "border-brand-700 bg-card-soft" : "border-line",
              )}
            >
              <input
                type="radio"
                name="kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
                className="sr-only"
              />
              <span className="font-medium">{option.label}</span>
              <span className="text-xs text-muted">{option.hint}</span>
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
        {pending ? "Salvando…" : "Adicionar à carteira"}
      </Button>
    </form>
  );
}
