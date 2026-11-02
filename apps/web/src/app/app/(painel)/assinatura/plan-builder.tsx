"use client";
// Tela de montar o plano. O total sai de `quotePlan`, a mesma conta que vai para a Stripe (ADR-0023): a
// tela não soma nada por conta própria.
import {
  CONNECTED_ITEM,
  CURRENCIES,
  discountedAmount,
  ENTRY_TIERS,
  entitlementsOf,
  FAMILY_SELECTION,
  itemsOf,
  MAX_CONNECTED_ACCOUNTS,
  MESSAGE_TIERS,
  normalizeSelection,
  PAID_MODULES,
  quotePlan,
  type BillingCycle,
  type CatalogPrice,
  type Currency,
  type EntryTier,
  type MessageTier,
  type PaidModule,
  type PlanSelection,
  type SubscribedItem,
} from "@organizeup/domain";
import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState, useTransition } from "react";
import { cx } from "@/components/styles";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormMessage,
  Input,
  Select,
  Sheet,
} from "@/components/ui";
import { formatDate } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { useMoney } from "@/i18n/money";
import { changePlan, previewPlan, subscribe, type PlanFailure, type PlanPreview } from "./actions";

const FAMILY_TIERS: readonly MessageTier[] = [100, 300];

export interface PlanBuilderProps {
  catalog: CatalogPrice[];
  /** Plano assinado. Null: ainda não assina. */
  current: PlanSelection | null;
  /** Itens assinados, com o preço de quando entraram. */
  items: SubscribedItem[];
  main: Currency;
  /** Só o responsável assina e troca. */
  canBuy: boolean;
  /** VIP sem custo: não há o que assinar agora. */
  vipFree?: boolean;
  /** Desconto que a Stripe vai aplicar. O total mostra o que a família paga de verdade. */
  discountPercent?: number | null;
}

/** Sair da Família completa leva o que ela trazia: só sai o módulo desmarcado. */
const leavingFamily = (selection: PlanSelection): PlanSelection => ({
  ...selection,
  family: false,
  entries: "ilimitado",
  modules: [...PAID_MODULES],
});

function Choice({
  checked,
  disabled,
  onChange,
  title,
  price,
  text,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  price?: string | undefined;
  text: string;
}) {
  return (
    <label
      className={cx(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3",
        checked ? "border-brand-500 bg-brand-50" : "border-line",
      )}
    >
      <input
        type="checkbox"
        className="mt-1 size-5 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-semibold">{title}</span>
          {price ? <span className="text-sm font-semibold tabular-nums">{price}</span> : null}
        </span>
        <span className="block text-sm text-muted">{text}</span>
      </span>
    </label>
  );
}

export function PlanBuilder({
  catalog,
  current,
  items,
  main,
  canBuy,
  vipFree = false,
  discountPercent = null,
}: PlanBuilderProps) {
  const t = useTranslations("assinatura");
  const locale = useLocale() as Locale;
  const moneyText = useMoney();
  const cycleName = useId();
  const [selection, setSelection] = useState<PlanSelection>(current ?? FAMILY_SELECTION);
  const [failure, setFailure] = useState<PlanFailure | null>(null);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, startTransition] = useTransition();

  const quote = useMemo(
    () => quotePlan(selection, catalog, current?.cycle === selection.cycle ? items : []),
    [selection, catalog, current, items],
  );
  const payable = discountedAmount(quote.total, discountPercent);
  const granted = entitlementsOf(itemsOf(selection));
  const priceOf = (item: string) => {
    const row = catalog.find((price) => price.item === item && price.cycle === selection.cycle);
    return row ? moneyText(row.amount, "full", "BRL") : undefined;
  };
  const perCycle = (amount: string) =>
    t(selection.cycle === "ano" ? "perYear" : "perMonth", {
      amount: moneyText(amount, "full", "BRL"),
    });
  const unchanged =
    current !== null &&
    current.cycle === selection.cycle &&
    current.connectedAccounts === selection.connectedAccounts &&
    itemsOf(current).toSorted().join() === itemsOf(selection).toSorted().join();

  const change = (next: PlanSelection) => {
    setSelection(normalizeSelection(next));
    setFailure(null);
    setSaved(false);
  };
  const toggleModule = (module: PaidModule, on: boolean) => {
    const from = selection.family ? leavingFamily(selection) : selection;
    change({
      ...from,
      modules: on ? [...from.modules, module] : from.modules.filter((item) => item !== module),
    });
  };
  const setMessages = (messages: MessageTier) => {
    // Na Família completa, tirar o assistente ou descer de 100 é sair dela.
    const leaving = selection.family && !FAMILY_TIERS.includes(messages);
    change({ ...(leaving ? leavingFamily(selection) : selection), messages });
  };
  const setEntries = (entries: EntryTier) =>
    change({ ...(selection.family ? leavingFamily(selection) : selection), entries });
  const toggleCurrency = (code: Currency, on: boolean) =>
    change({
      ...selection,
      currencies: on
        ? [...selection.currencies, code]
        : selection.currencies.filter((item) => item !== code),
    });

  const buy = () =>
    startTransition(async () => {
      setFailure(null);
      const reply = await subscribe(selection).catch(
        () => ({ ok: false, code: "falhou" }) as const,
      );
      if (reply.ok) window.location.assign(reply.url);
      else setFailure(reply.code);
    });
  const askPreview = () =>
    startTransition(async () => {
      setFailure(null);
      const reply = await previewPlan(selection).catch(
        () => ({ ok: false, code: "falhou" }) as const,
      );
      if (reply.ok) setPreview(reply.preview);
      else setFailure(reply.code);
    });
  const confirm = () =>
    startTransition(async () => {
      const reply = await changePlan(selection, preview?.prorationDate ?? null).catch(
        () => ({ ok: false, code: "falhou" }) as const,
      );
      setPreview(null);
      if (reply.ok) setSaved(true);
      else setFailure(reply.code);
    });

  if (catalog.length === 0) {
    return <EmptyState title={t("noCatalog.title")} text={t("noCatalog.text")} />;
  }

  const extras = CURRENCIES.filter((code) => code !== main);
  // Sem preço à venda neste ciclo, o campo nem existe: fora de venda, é invisível.
  const connectedPrice = priceOf(CONNECTED_ITEM);
  const entryLabel = (tier: EntryTier) =>
    tier === "ilimitado" ? t("entries.unlimited") : t("entries.upTo", { count: Number(tier) });
  const messageLabel = (tier: MessageTier) =>
    tier === 0 ? t("messages.none") : t("messages.count", { count: tier });
  const released = [
    t("released.base"),
    granted.entryLimit === null
      ? t("released.entriesUnlimited")
      : t("released.entries", { count: granted.entryLimit }),
    ...granted.modules
      .filter((module) => module !== "assistente")
      .map((module) => t(`modules.${module}.name`)),
    ...(granted.messageLimit > 0 ? [t("released.messages", { count: granted.messageLimit })] : []),
    ...granted.currencies.map((code) => t("released.currency", { code })),
    ...(selection.connectedAccounts > 0
      ? [t("released.connected", { count: selection.connectedAccounts })]
      : []),
  ];

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-6">
        {/* No celular o resumo fica no fim da página: o total acompanha quem está escolhendo. */}
        <p
          aria-hidden="true"
          data-testid="plano-total-fixo"
          className="sticky top-2 z-10 m-0 flex items-baseline justify-between gap-3 rounded-xl border border-line bg-card px-4 py-2 text-sm shadow-card lg:hidden"
        >
          <span className="text-muted">{t("summary.title")}</span>
          <span className="font-bold tabular-nums">{perCycle(payable)}</span>
        </p>
        <Card title={t("cycle.title")}>
          <fieldset className="m-0 grid grid-cols-2 gap-2 border-0 p-0">
            <legend className="sr-only">{t("cycle.title")}</legend>
            {(["mes", "ano"] as const satisfies readonly BillingCycle[]).map((cycle) => (
              <label
                key={cycle}
                className={cx(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold",
                  selection.cycle === cycle ? "border-brand-500 bg-brand-50" : "border-line",
                )}
              >
                <input
                  type="radio"
                  name={cycleName}
                  checked={selection.cycle === cycle}
                  onChange={() => change({ ...selection, cycle })}
                />
                {t(`cycle.${cycle}`)}
              </label>
            ))}
          </fieldset>
          <p className="m-0 mt-2 text-sm text-muted">{t("cycle.hint")}</p>
        </Card>

        <Card title={t("family.title")} description={t("family.text")}>
          <Choice
            checked={selection.family}
            onChange={(on) =>
              change(
                on ? { ...FAMILY_SELECTION, ...keepExtras(selection) } : leavingFamily(selection),
              )
            }
            title={t("family.choice")}
            price={priceOf("familia")}
            text={t("family.includes")}
          />
        </Card>

        <Card title={t("build.title")} description={t("build.text")}>
          <div className="flex flex-col gap-4">
            <Field label={t("entries.label")} hint={t("entries.hint")}>
              <Select
                value={selection.entries}
                onChange={(event) => setEntries(event.target.value as EntryTier)}
              >
                {ENTRY_TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {`${entryLabel(tier)} · ${priceOf(`base:${tier}`) ?? ""}`}
                  </option>
                ))}
              </Select>
            </Field>

            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-medium">{t("modules.label")}</legend>
              {PAID_MODULES.map((module) => (
                <Choice
                  key={module}
                  checked={selection.modules.includes(module)}
                  onChange={(on) => toggleModule(module, on)}
                  title={t(`modules.${module}.name`)}
                  price={selection.family ? undefined : priceOf(`modulo:${module}`)}
                  text={t(`modules.${module}.text`)}
                />
              ))}
            </fieldset>

            <Field label={t("messages.label")} hint={t("messages.hint")}>
              <Select
                value={String(selection.messages)}
                onChange={(event) => setMessages(Number(event.target.value) as MessageTier)}
              >
                {MESSAGE_TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {tier === 0
                      ? messageLabel(tier)
                      : `${messageLabel(tier)} · ${
                          selection.family && tier === 100
                            ? t("messages.included")
                            : (priceOf(
                                selection.family ? "familia_mensagens:300" : `assistente:${tier}`,
                              ) ?? "")
                        }`}
                  </option>
                ))}
              </Select>
            </Field>

            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-medium">{t("currencies.label")}</legend>
              {extras.map((code) => (
                <Choice
                  key={code}
                  checked={selection.currencies.includes(code)}
                  onChange={(on) => toggleCurrency(code, on)}
                  title={t(`currencies.${code}`)}
                  price={priceOf(`moeda:${code}`)}
                  text={t("currencies.text")}
                />
              ))}
            </fieldset>

            {connectedPrice ? (
              <Field
                label={t("connected.label")}
                hint={t("connected.hint", { amount: connectedPrice })}
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_CONNECTED_ACCOUNTS}
                  value={selection.connectedAccounts}
                  onChange={(event) =>
                    change({ ...selection, connectedAccounts: Number(event.target.value) || 0 })
                  }
                />
              </Field>
            ) : null}
          </div>
        </Card>
      </div>

      <aside
        aria-label={t("summary.title")}
        className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-5 lg:sticky lg:top-6"
      >
        <div aria-live="polite">
          <p className="m-0 text-sm text-muted">{t("summary.title")}</p>
          <p className="m-0 text-2xl font-bold tabular-nums" data-testid="plano-total">
            {perCycle(payable)}
          </p>
          {discountPercent ? (
            <p className="m-0 text-sm text-muted">
              {t("status.discountNote", { percent: discountPercent })}
            </p>
          ) : null}
          {selection.family ? <Badge tone="success">{t("summary.familyBadge")}</Badge> : null}
          {quote.familySaves ? (
            <div className="mt-2 rounded-xl bg-brand-50 p-3 text-sm">
              <p className="m-0">
                {t("summary.familySaves", { amount: moneyText(quote.familySaves, "full", "BRL") })}
              </p>
              <Button
                small
                variant="secondary"
                className="mt-2"
                onClick={() => change({ ...FAMILY_SELECTION, ...keepExtras(selection) })}
              >
                {t("summary.backToFamily")}
              </Button>
            </div>
          ) : null}
        </div>
        {saved ? <FormMessage message={t("saved")} tone="ok" /> : null}
        {failure ? <FormMessage message={t(`failure.${failure}`)} /> : null}
        {quote.missing.length > 0 ? <FormMessage message={t("failure.catalogo")} /> : null}
        {!canBuy ? (
          <p className="m-0 text-sm text-muted">{t(vipFree ? "vipNote" : "ownerOnly")}</p>
        ) : current ? (
          <Button disabled={busy || unchanged} onClick={askPreview}>
            {busy ? t("wait") : t("seeChange")}
          </Button>
        ) : (
          <Button disabled={busy || quote.missing.length > 0} onClick={buy}>
            {busy ? t("wait") : t("subscribe")}
          </Button>
        )}
        <div>
          <p className="m-0 text-sm font-semibold">{t("summary.released")}</p>
          <ul className="m-0 mt-1 list-disc pl-5 text-sm">
            {released.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <p className="m-0 text-xs text-muted">{t("summary.note")}</p>
      </aside>

      <Sheet open={preview !== null} onClose={() => setPreview(null)} title={t("preview.title")}>
        {preview ? (
          <div className="flex flex-col gap-3 text-sm">
            {preview.dueNow !== null ? (
              <p className="m-0">
                {t("preview.now", { amount: moneyText(preview.dueNow, "full", "BRL") })}
              </p>
            ) : null}
            {preview.laterAt ? (
              <p className="m-0">
                {t("preview.later", {
                  date: formatDate(preview.laterAt.slice(0, 10), locale),
                  items: preview.removed.map(itemName).join(", ") || t("preview.nothing"),
                })}
              </p>
            ) : null}
            {preview.dueNow !== null && !preview.laterAt && preview.removed.length > 0 ? (
              <p className="m-0">
                {t("preview.removedNow", { items: preview.removed.map(itemName).join(", ") })}
              </p>
            ) : null}
            {preview.nextChargeAt ? (
              <p className="m-0">
                {t("preview.nextAt", {
                  date: formatDate(preview.nextChargeAt.slice(0, 10), locale),
                })}
              </p>
            ) : null}
            <p className="m-0 font-semibold">
              {t("preview.next", { amount: perCycle(preview.nextTotal) })}
            </p>
            <div className="flex gap-2">
              <Button disabled={busy} onClick={confirm}>
                {busy ? t("wait") : t("preview.confirm")}
              </Button>
              <Button variant="secondary" onClick={() => setPreview(null)}>
                {t("preview.back")}
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );

  function itemName(item: string): string {
    const [kind, value = ""] = item.split(":");
    if (kind === "modulo") return t(`modules.${value as PaidModule}.name`);
    if (kind === "moeda") return t(`currencies.${value as Currency}`);
    if (kind === "familia") return t("family.choice");
    if (kind === CONNECTED_ITEM) return t("connected.label");
    if (kind === "base") return entryLabel(value as EntryTier);
    return t("messages.count", { count: Number(value) });
  }
}

/** Voltar para a Família completa não mexe em ciclo, moedas nem no degrau alto de mensagens. */
const keepExtras = (selection: PlanSelection): Partial<PlanSelection> => ({
  cycle: selection.cycle,
  currencies: selection.currencies,
  connectedAccounts: selection.connectedAccounts,
  messages: selection.messages === 300 ? 300 : 100,
});
