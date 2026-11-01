"use client";
import { Building2, Car, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { money } from "@organizeup/domain";
import { FxNote } from "@/components/fx-note";
import {
  Button,
  Card,
  ConfirmSheet,
  Field,
  FormMessage,
  IconButton,
  Input,
  PageHeader,
  Select,
  Sheet,
  StatTile,
} from "@/components/ui";
import { formatAmount, formatDate, toFieldValue } from "@/i18n/format";
import type { loadNetWorth } from "@/lib/wealth";
import { systemTextOf } from "@/i18n/system-text";
import { deleteAsset, saveAsset, type AssetFormState } from "./actions";
import { NetWorthChart } from "./net-worth-chart";

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

function Row({ name, value, hint }: { name: string; value: string; hint?: string }) {
  const locale = useLocale();
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="min-w-0">
        <p>{name}</p>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
      <span className="whitespace-nowrap font-medium tabular-nums">
        {formatAmount(value, locale)}
      </span>
    </li>
  );
}

export function NetWorthBoard({ data, writable }: { data: Data; writable: boolean }) {
  const t = useTranslations("patrimonio");
  const system = systemTextOf(useTranslations("sistema"));
  const locale = useLocale();
  const amount = (value: string) => formatAmount(value, locale);
  const [editing, setEditing] = useState<{ nonce: number; asset: Asset | null } | null>(null);
  const [removing, setRemoving] = useState<Asset | null>(null);
  const close = () => setEditing(null);
  const open = (asset: Asset | null) => setEditing((s) => ({ nonce: (s?.nonce ?? 0) + 1, asset }));
  const { summary } = data;

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
      <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile label={t("stats.owned")} value={amount(summary.owned)} />
        <StatTile label={t("stats.owed")} value={amount(summary.owed)} />
        <StatTile
          label={t("stats.assets")}
          value={amount(summary.assets)}
          hint={t("stats.assetsHint")}
        />
        <StatTile
          label={t("stats.cards")}
          value={amount(summary.cards)}
          hint={t("stats.cardsHint")}
        />
      </dl>

      <Card title={t("evolution.title")} description={t("evolution.description")}>
        <NetWorthChart points={data.history} />
      </Card>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Card title={t("owned.title")}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t("owned.accounts")}
          </h3>
          <ul aria-label={t("owned.accounts")} className="m-0 list-none divide-y divide-line p-0">
            {data.accounts.map((account) => (
              <Row key={account.id} name={system.name(account.name)} value={account.balance} />
            ))}
          </ul>

          {money(summary.investments).gt(0) ? (
            <>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
                {t("owned.investments")}
              </h3>
              <ul
                aria-label={t("owned.investments")}
                className="m-0 list-none divide-y divide-line p-0"
              >
                <Row name={t("owned.portfolio")} value={summary.investments} />
              </ul>
            </>
          ) : null}

          {money(summary.goals).gt(0) ? (
            <>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
                <Link href="/app/metas" className="underline-offset-2 hover:underline">
                  {t("owned.goals")}
                </Link>
              </h3>
              <ul aria-label={t("owned.goals")} className="m-0 list-none divide-y divide-line p-0">
                <Row name={t("owned.savedForGoals")} value={summary.goals} />
              </ul>
            </>
          ) : null}

          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
            {t("owned.assets")}
          </h3>
          {data.assets.length === 0 ? (
            <div className="mt-2 flex flex-col items-start gap-2 text-sm text-muted">
              <p>{t("owned.assetsEmpty")}</p>
              {writable ? (
                <Button variant="secondary" small onClick={() => open(null)}>
                  {t("owned.addAsset")}
                </Button>
              ) : null}
            </div>
          ) : (
            <ul aria-label={t("owned.assets")} className="m-0 list-none divide-y divide-line p-0">
              {data.assets.map((asset) => {
                const Icon = ICONS[asset.kind];
                return (
                  <li key={asset.id} className="flex items-center gap-3 py-2">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium">{asset.name}</p>
                      <p className="font-medium tabular-nums sm:hidden">{amount(asset.value)}</p>
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
        </Card>

        <Card title={t("owes.title")}>
          {data.debts.length === 0 && summary.cardBalances.length === 0 ? (
            <p className="text-sm text-muted">{t("owes.empty")}</p>
          ) : (
            <>
              {data.debts.length > 0 ? (
                <>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    <Link href="/app/dividas" className="underline-offset-2 hover:underline">
                      {t("owes.debts")}
                    </Link>
                  </h3>
                  <ul
                    aria-label={t("owes.debts")}
                    className="m-0 list-none divide-y divide-line p-0"
                  >
                    {data.debts.map((debt) => (
                      <Row key={debt.id} name={debt.name} value={debt.balance} />
                    ))}
                  </ul>
                </>
              ) : null}
              {summary.cardBalances.length > 0 ? (
                <>
                  <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted first:mt-0">
                    <Link href="/app/cartoes" className="underline-offset-2 hover:underline">
                      {t("owes.cards")}
                    </Link>
                  </h3>
                  <ul
                    aria-label={t("owes.cards")}
                    className="m-0 list-none divide-y divide-line p-0"
                  >
                    {summary.cardBalances.map((card) => (
                      <Row key={card.id} name={card.name} value={card.balance} />
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          )}
        </Card>
      </div>

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
