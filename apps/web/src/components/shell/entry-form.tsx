"use client";
import { useActionState, useEffect, useState } from "react";
import { CARD_CATEGORY, type MonthEntry } from "@organizeup/domain";
import { saveEntry, type EntryFormState } from "@/app/app/(painel)/lancamentos/actions";
import { cx } from "@/components/styles";
import { Button, Field, FormMessage, Input, Select } from "@/components/ui";
import { DEFAULT_LOCALE } from "@/i18n/locales";

const initial: EntryFormState = { ok: false, message: null };

export interface EntryOptions {
  accounts: Array<{ id: string; name: string; archived: boolean }>;
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
>;

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
  const [state, action, pending] = useActionState(saveEntry, initial);
  const [kind, setKind] = useState(initialKind);
  const [paidWith, setPaidWith] = useState(
    initialCard ? `card:${initialCard}` : (entry?.accountId ?? options.accounts[0]?.id ?? ""),
  );
  const isPlan = entry?.source === "previsao";
  const showCards = !entry && kind === "despesa" && options.cards.length > 0;
  const onCard = showCards && paidWith.startsWith("card:");

  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={action} lang={DEFAULT_LOCALE} className="flex flex-col gap-4">
      {entry ? <input type="hidden" name="key" value={entry.key} /> : null}
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Tipo</legend>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-brand-50 p-1">
          {(
            [
              ["despesa", "Despesa"],
              ["receita", "Receita"],
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

      <Field label="Descrição" error={state.fieldErrors?.description}>
        <Input
          name="description"
          required
          maxLength={120}
          placeholder={kind === "despesa" ? "Ex.: Conta de luz" : "Ex.: Salário"}
          defaultValue={entry?.description}
        />
      </Field>
      <div className="grid grid-cols-[2fr_3fr] gap-3">
        <Field label="Valor (R$)" error={state.fieldErrors?.amount}>
          <Input
            name="amount"
            inputMode="decimal"
            required
            placeholder="0,00"
            defaultValue={entry?.amount.replace(".", ",")}
          />
        </Field>
        <Field label="Data" error={state.fieldErrors?.date}>
          <Input name="date" type="date" required defaultValue={entry?.date ?? today} />
        </Field>
      </div>
      <Field label="Categoria" error={state.fieldErrors?.categoryId}>
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
                {category.name}
              </option>
            ))}
        </Select>
      </Field>
      <Field label={showCards ? "Conta ou cartão" : "Conta"} error={state.fieldErrors?.accountId}>
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
                {account.name}
              </option>
            ))}
          {showCards ? (
            <optgroup label="Cartões">
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
          label="Parcelas"
          hint="Cada parcela entra numa fatura."
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
          {kind === "despesa" ? "Já foi pago" : "Já foi recebido"}
        </label>
      ) : null}
      {!entry && !onCard ? (
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" name="repeat" className="size-5 accent-brand-500" />
          Repete todo mês
        </label>
      ) : null}
      {isPlan ? (
        <p className="rounded-xl bg-brand-50 p-3 text-sm text-muted">
          Esta conta se repete todo mês. A alteração vale para todos os meses em aberto, e da data
          usamos só o dia.
        </p>
      ) : null}

      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : entry ? "Salvar alterações" : "Salvar lançamento"}
      </Button>
    </form>
  );
}
