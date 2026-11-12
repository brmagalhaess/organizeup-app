"use client";
import {
  Building2,
  Car,
  ChevronRight,
  Equal,
  Minus,
  Package,
  Pencil,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { money, yearMonthOf } from "@organizeup/domain";
import { FxNote } from "@/components/fx-note";
import { cx } from "@/components/styles";
import {
  Badge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  FormMessage,
  IconButton,
  Input,
  PageHeader,
  Select,
  Sheet,
} from "@/components/ui";
import { formatDate, formatMonthYear, formatPercentExact, toFieldValue } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import {
  debtShare,
  netWorthChange,
  netWorthParts,
  type NetWorthPartKey,
} from "@/lib/net-worth-view";
import type { loadNetWorth } from "@/lib/wealth";
import { systemTextOf } from "@/i18n/system-text";
import { deleteAsset, saveAsset, type AssetFormState } from "./actions";
import { NetWorthChart } from "./net-worth-chart";
import { useMoney } from "@/i18n/money";

type Data = Awaited<ReturnType<typeof loadNetWorth>>;
type Asset = Data["assets"][number];

const ICONS = { imovel: Building2, veiculo: Car, outro: Package } as const;
const KINDS = Object.keys(ICONS) as Array<keyof typeof ICONS>;

const initial: AssetFormState = { ok: false, message: null };

/** Valor do banco de volta ao campo, com as duas casas: "500.00" vira "500,00" em português. */
function AssetForm({
  asset,
  data,
  onDone,
}: {
  asset: Asset | null;
  data: Data;
  onDone: () => void;
}) {
  const t = useTranslations("patrimonio");
  const common = useTranslations("common");
  const locale = useLocale();
  const [state, action, pending] = useActionState(saveAsset, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={asset?.id ?? ""} />
      <Field label={t("form.name")}>
        <Input
          name="name"
          required
          maxLength={80}
          placeholder={t("form.namePlaceholder")}
          defaultValue={asset?.name}
        />
      </Field>
      <Field label={t("form.kind")}>
        <Select name="kind" defaultValue={asset?.kind ?? "imovel"}>
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`kinds.${kind}`)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-[3fr_2fr] gap-3">
        <Field label={t("form.value")} hint={t("form.valueHint")}>
          <Input
            name="value"
            inputMode="decimal"
            required
            placeholder={t("amountPlaceholder")}
            defaultValue={asset ? toFieldValue(asset.value, locale) : undefined}
          />
        </Field>
        <Field label={t("form.valuedOn")}>
          <Input
            name="valuedOn"
            type="date"
            required
            defaultValue={asset?.valuedOn ?? data.today}
          />
        </Field>
      </div>
      {data.debtOptions.length > 0 ? (
        <Field label={t("form.linkedDebt")} hint={t("form.linkedDebtHint")}>
          <Select name="linkedDebtId" defaultValue={asset?.linkedDebtId ?? ""}>
            <option value="">{t("form.noDebt")}</option>
            {data.debtOptions.map((debt) => (
              <option key={debt.id} value={debt.id}>
                {debt.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="linkedDebtId" value="" />
      )}
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? common("saving") : t("form.submit")}
      </Button>
    </form>
  );
}

// Cor de cada parte do que a pessoa tem, sempre na mesma ordem: a barra, a lista e os grupos usam a mesma.
const PART_COLOR: Record<NetWorthPartKey, string> = {
  accounts: "bg-part-1",
  investments: "bg-part-2",
  assets: "bg-part-3",
  goals: "bg-part-4",
};

function Swatch({ part }: { part: NetWorthPartKey }) {
  return (
    <span
      aria-hidden="true"
      className={cx("inline-block size-2.5 shrink-0 rounded-sm", PART_COLOR[part])}
    />
  );
}

function Row({
  name,
  value,
  hint,
  negativeTag,
}: {
  name: string;
  value: string;
  hint?: string;
  /** Rótulo para saldo negativo: o sinal não fica só na cor. */
  negativeTag?: string;
}) {
  const moneyText = useMoney();
  const negative = negativeTag !== undefined && money(value).lt(0);
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          {name}
          {negative ? <Badge tone="danger">{negativeTag}</Badge> : null}
        </p>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
      <span className={cx("whitespace-nowrap font-medium tabular-nums", negative && "text-danger")}>
        {moneyText(value)}
      </span>
    </li>
  );
}

/** Um grupo do detalhe: nome, subtotal, o que explica o número, as linhas e o caminho para a tela dele. */
function Group({
  part,
  title,
  total,
  hint,
  link,
  children,
}: {
  part?: NetWorthPartKey;
  title: string;
  total: string;
  hint?: string;
  link?: { href: string; label: string };
  children: ReactNode;
}) {
  const moneyText = useMoney();
  return (
    <section aria-label={title} className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {part ? <Swatch part={part} /> : null}
          {title}
        </h3>
        <span className="whitespace-nowrap text-sm font-semibold tabular-nums">
          {moneyText(total)}
        </span>
      </header>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      <div className="mt-1">{children}</div>
      {link ? (
        <Link
          href={link.href}
          className="mt-1 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
        >
          {link.label}
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      ) : null}
    </section>
  );
}

export function NetWorthBoard({ data, writable }: { data: Data; writable: boolean }) {
  const t = useTranslations("patrimonio");
  const tClass = useTranslations("investimentos.classes");
  const system = systemTextOf(useTranslations("sistema"));
  const locale = useLocale() as Locale;
  const moneyText = useMoney();
  const amount = (value: string) => moneyText(value);
  const [editing, setEditing] = useState<{ nonce: number; asset: Asset | null } | null>(null);
  const [removing, setRemoving] = useState<Asset | null>(null);
  const close = () => setEditing(null);
  const open = (asset: Asset | null) => setEditing((s) => ({ nonce: (s?.nonce ?? 0) + 1, asset }));
  const { summary } = data;

  const parts = netWorthParts(summary);
  const shown = parts.filter((part) => part.percent > 0);
  const partName = (key: NetWorthPartKey) =>
    t(key === "goals" ? "owned.savedForGoals" : `owned.${key}`);
  const change = netWorthChange(data.history, yearMonthOf(data.today), summary.net);
  const share = debtShare(summary.owned, summary.owed);
  const percentText = (percent: number) => formatPercentExact(percent, locale, 1);
  const className = (assetClass: string) =>
    tClass.has(assetClass as never) ? tClass(assetClass as never) : assetClass;
  const empty = money(summary.owned).isZero() && money(summary.owed).isZero();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={amount(summary.net)}
        description={t("description")}
        actions={
          writable ? (
            <Button variant="secondary" onClick={() => open(null)}>
              <Plus className="size-4" aria-hidden="true" />
              {t("newAsset")}
            </Button>
          ) : null
        }
      />

      <FxNote fx={data.fx} />

      {/* A conta, por extenso: o que tem, menos o que deve, igual ao patrimônio. */}
      <section
        aria-label={t("equation.label")}
        className="rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6"
      >
        <dl className="m-0 grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="rounded-xl bg-card-soft p-4">
            <dt className="text-sm text-muted">{t("stats.owned")}</dt>
            <dd className="m-0 mt-1 whitespace-nowrap text-2xl font-semibold tabular-nums tracking-tight">
              {amount(summary.owned)}
            </dd>
            <p className="m-0 mt-1 text-xs text-muted">{t("equation.ownedHint")}</p>
          </div>
          <div
            role="img"
            aria-label={t("equation.minus")}
            className="flex items-center justify-center text-muted"
          >
            <Minus className="size-5" aria-hidden="true" />
          </div>
          <div className="rounded-xl bg-card-soft p-4">
            <dt className="text-sm text-muted">{t("stats.owed")}</dt>
            <dd className="m-0 mt-1 whitespace-nowrap text-2xl font-semibold tabular-nums tracking-tight">
              {amount(summary.owed)}
            </dd>
            <p className="m-0 mt-1 text-xs text-muted">{t("equation.owedHint")}</p>
          </div>
          <div
            role="img"
            aria-label={t("equation.equals")}
            className="flex items-center justify-center text-muted"
          >
            <Equal className="size-5" aria-hidden="true" />
          </div>
          <div className="rounded-xl bg-pine p-4 text-white">
            <dt className="text-sm text-white/80">{t("equation.net")}</dt>
            <dd className="m-0 mt-1 whitespace-nowrap text-2xl font-semibold tabular-nums tracking-tight">
              {amount(summary.net)}
            </dd>
            <p className="m-0 mt-1 flex items-center gap-1.5 text-xs text-white/85">
              {change?.direction === "subiu" ? (
                <TrendingUp className="size-4 shrink-0" aria-hidden="true" />
              ) : change?.direction === "caiu" ? (
                <TrendingDown className="size-4 shrink-0" aria-hidden="true" />
              ) : null}
              {change === null
                ? t("equation.noHistory")
                : change.direction === "igual"
                  ? t("equation.same", { month: formatMonthYear(change.month, locale) })
                  : t(change.direction === "subiu" ? "equation.up" : "equation.down", {
                      amount: amount(money(change.amount).abs().toFixed(2)),
                      month: formatMonthYear(change.month, locale),
                    })}
            </p>
          </div>
        </dl>
        {empty ? null : (
          <div className="mt-4">
            <div
              role="img"
              aria-label={
                share === null
                  ? t("equation.shareOver")
                  : share === 0
                    ? t("equation.shareNone")
                    : t("equation.share", { percent: percentText(share) })
              }
              className="h-2 overflow-hidden rounded-full bg-brand-100"
            >
              <div
                className={cx("h-full rounded-full", share === null ? "bg-danger" : "bg-clay")}
                style={{ width: `${share === null ? 100 : share === 0 ? 0 : Math.max(share, 1)}%` }}
              />
            </div>
            <p className="m-0 mt-2 text-sm text-muted">
              {share === null
                ? t("equation.shareOver")
                : share === 0
                  ? t("equation.shareNone")
                  : t("equation.share", { percent: percentText(share) })}
            </p>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <Card title={t("composition.title")} description={t("composition.text")}>
          {shown.length === 0 ? (
            <EmptyState title={t("composition.emptyTitle")} text={t("composition.emptyText")} />
          ) : (
            <>
              {/* Uma barra só: cada cor é uma parte, com 2px de respiro entre elas. */}
              <div
                role="img"
                aria-label={t("composition.barLabel")}
                className="flex h-5 gap-0.5 overflow-hidden rounded-md"
              >
                {shown.map((part) => (
                  <div
                    key={part.key}
                    title={t("composition.part", {
                      name: partName(part.key),
                      percent: percentText(part.percent),
                    })}
                    className={cx("h-full min-w-1", PART_COLOR[part.key])}
                    style={{ width: `${part.percent}%` }}
                  />
                ))}
              </div>
              <table className="mt-4 w-full border-collapse text-sm">
                <caption className="sr-only">{t("composition.caption")}</caption>
                <thead className="sr-only">
                  <tr>
                    <th scope="col">{t("composition.colPart")}</th>
                    <th scope="col">{t("composition.colShare")}</th>
                    <th scope="col">{t("composition.colValue")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {parts
                    .filter((part) => !money(part.value).isZero())
                    .map((part) => (
                      <tr key={part.key}>
                        <th scope="row" className="py-2 pr-2 text-left font-normal">
                          <span className="flex items-center gap-2">
                            <Swatch part={part.key} />
                            {partName(part.key)}
                          </span>
                          {money(part.value).lt(0) ? (
                            <span className="mt-0.5 block pl-4.5 text-xs text-muted">
                              {t("composition.negative")}
                            </span>
                          ) : null}
                        </th>
                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-muted">
                          {money(part.value).lt(0) ? "" : percentText(part.percent)}
                        </td>
                        <td className="whitespace-nowrap py-2 pl-2 text-right font-medium tabular-nums">
                          {amount(part.value)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          )}
        </Card>

        <Card title={t("evolution.title")} description={t("evolution.description")}>
          <NetWorthChart points={data.history} />
        </Card>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Card title={t("owned.title")}>
          <div className="flex flex-col gap-4">
            <Group
              part="accounts"
              title={t("owned.accounts")}
              total={summary.accounts}
              link={{ href: "/app/contas", label: t("groups.accountsLink") }}
            >
              <ul
                aria-label={t("owned.accounts")}
                className="m-0 list-none divide-y divide-line p-0"
              >
                {data.accounts.map((account) => (
                  <Row
                    key={account.id}
                    name={system.name(account.name)}
                    value={account.balance}
                    negativeTag={t("groups.negativeTag")}
                  />
                ))}
              </ul>
            </Group>

            {money(summary.investments).gt(0) ? (
              <Group
                part="investments"
                title={t("owned.investments")}
                total={summary.investments}
                link={{ href: "/app/investimentos", label: t("groups.investmentsLink") }}
              >
                <ul
                  aria-label={t("owned.investments")}
                  className="m-0 list-none divide-y divide-line p-0"
                >
                  {data.investmentClasses.map((share) => (
                    <Row
                      key={share.assetClass}
                      name={className(share.assetClass)}
                      value={share.value}
                    />
                  ))}
                </ul>
              </Group>
            ) : null}

            <Group
              part="assets"
              title={t("owned.assets")}
              total={summary.assets}
              hint={data.assets.length > 0 ? t("groups.assetsHint") : undefined}
            >
              {data.assets.length === 0 ? (
                <div className="mt-1 flex flex-col items-start gap-2 text-sm text-muted">
                  <p>{t("owned.assetsEmpty")}</p>
                  {writable ? (
                    <Button variant="secondary" small onClick={() => open(null)}>
                      {t("owned.addAsset")}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <ul
                  aria-label={t("owned.assets")}
                  className="m-0 list-none divide-y divide-line p-0"
                >
                  {data.assets.map((asset) => {
                    const Icon = ICONS[asset.kind];
                    return (
                      <li key={asset.id} className="flex items-center gap-3 py-2">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                          <Icon className="size-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="font-medium">{asset.name}</p>
                          <p className="font-medium tabular-nums sm:hidden">
                            {amount(asset.value)}
                          </p>
                          <p className="text-xs text-muted">
                            {t("owned.valuedOn", {
                              kind: t(`kinds.${asset.kind}`),
                              date: formatDate(asset.valuedOn, locale),
                            })}
                          </p>
                          {asset.equity !== null ? (
                            <p className="text-xs text-muted">
                              {t("owned.equity", { amount: amount(asset.equity) })}
                            </p>
                          ) : null}
                        </div>
                        <span className="hidden whitespace-nowrap text-sm font-medium tabular-nums sm:block">
                          {amount(asset.value)}
                        </span>
                        {writable ? (
                          <div className="flex shrink-0">
                            <IconButton
                              label={t("owned.edit", { name: asset.name })}
                              onClick={() => open(asset)}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </IconButton>
                            <IconButton
                              label={t("owned.delete", { name: asset.name })}
                              onClick={() => setRemoving(asset)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </IconButton>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Group>

            {money(summary.goals).gt(0) ? (
              <Group
                part="goals"
                title={t("owned.goals")}
                total={summary.goals}
                hint={t("groups.goalsHint")}
                link={{ href: "/app/metas", label: t("groups.goalsLink") }}
              >
                <ul
                  aria-label={t("owned.goals")}
                  className="m-0 list-none divide-y divide-line p-0"
                >
                  <Row name={t("owned.savedForGoals")} value={summary.goals} />
                </ul>
              </Group>
            ) : null}
          </div>
        </Card>

        <Card title={t("owes.title")}>
          {data.debts.length === 0 && summary.cardBalances.length === 0 ? (
            <p className="text-sm text-muted">{t("owes.empty")}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {data.debts.length > 0 ? (
                <Group
                  title={t("owes.debts")}
                  total={summary.debts}
                  hint={t("groups.debtsHint")}
                  link={{ href: "/app/dividas", label: t("groups.debtsLink") }}
                >
                  <ul
                    aria-label={t("owes.debts")}
                    className="m-0 list-none divide-y divide-line p-0"
                  >
                    {data.debts.map((debt) => (
                      <Row key={debt.id} name={debt.name} value={debt.balance} />
                    ))}
                  </ul>
                </Group>
              ) : null}
              {summary.cardBalances.length > 0 ? (
                <Group
                  title={t("owes.cards")}
                  total={summary.cards}
                  hint={t("groups.cardsHint")}
                  link={{ href: "/app/cartoes", label: t("groups.cardsLink") }}
                >
                  <ul
                    aria-label={t("owes.cards")}
                    className="m-0 list-none divide-y divide-line p-0"
                  >
                    {summary.cardBalances.map((card) => (
                      <Row key={card.id} name={card.name} value={card.balance} />
                    ))}
                  </ul>
                </Group>
              ) : null}
            </div>
          )}
        </Card>
      </div>

      <details className="rounded-2xl border border-line bg-card-soft px-5 py-4 text-sm">
        <summary className="cursor-pointer font-semibold">{t("how.title")}</summary>
        <ul className="m-0 mt-3 flex list-disc flex-col gap-2 pl-5 text-muted">
          <li>{t("how.owned")}</li>
          <li>{t("how.owed")}</li>
          <li>{t("how.photo")}</li>
        </ul>
      </details>

      <Sheet
        open={editing !== null}
        onClose={close}
        title={editing?.asset ? t("sheet.edit") : t("sheet.new")}
      >
        <AssetForm key={editing?.nonce} asset={editing?.asset ?? null} data={data} onDone={close} />
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("confirm.title")}
        text={t("confirm.text", { name: removing?.name ?? "" })}
        confirmLabel={t("confirm.action")}
        action={deleteAsset}
        hidden={{ id: removing?.id ?? "" }}
      />
    </div>
  );
}
