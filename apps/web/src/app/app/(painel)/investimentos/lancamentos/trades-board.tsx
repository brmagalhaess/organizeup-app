"use client";
import { Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { isUnitPriced, money, toDbAmount } from "@organizeup/domain";
import {
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  IconButton,
  PageHeader,
  Select,
  Sheet,
} from "@/components/ui";
import { formatDate } from "@/i18n/format";
import { systemTextOf } from "@/i18n/system-text";
import { deleteTrade } from "../actions";
import { quantityText, type Data, type Trade } from "../shared";
import { TradeForm } from "../trade-form";
import { useMoney } from "@/i18n/money";

const sideKey = (unit: boolean, buying: boolean) =>
  unit ? (buying ? "buy" : "sell") : buying ? "deposit" : "redeem";

/** Todas as operações da carteira, da mais nova à mais antiga, com o valor e a conta usada. */
export function TradesBoard({
  data,
  assetId,
  writable,
}: {
  data: Data;
  assetId: string | null;
  writable: boolean;
}) {
  const t = useTranslations("investimentos");
  const system = systemTextOf(useTranslations("sistema"));
  const locale = useLocale();
  const moneyText = useMoney();
  const router = useRouter();
  const [removing, setRemoving] = useState<Trade | null>(null);
  const [adding, setAdding] = useState<{ nonce: number } | null>(null);
  const [target, setTarget] = useState(assetId ?? data.rows[0]?.id ?? "");
  const close = () => setAdding(null);

  const lines = useMemo(
    () =>
      data.rows
        .filter((row) => !assetId || row.id === assetId)
        .flatMap((row) => row.trades.map((trade) => ({ row, trade })))
        .sort((a, b) => b.trade.occurredOn.localeCompare(a.trade.occurredOn)),
    [data.rows, assetId],
  );
  const net = lines.reduce((acc, { trade }) => {
    const value = money(trade.quantity).times(trade.unitPrice);
    return trade.side === "compra" ? acc.plus(value) : acc.minus(value);
  }, money(0));
  const selected = data.rows.find((row) => row.id === target) ?? null;

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("trades.title")}
        description={t("trades.description")}
        actions={
          writable && data.rows.length > 0 ? (
            <Button variant="secondary" onClick={() => setAdding({ nonce: Date.now() })}>
              <Plus className="size-4" aria-hidden="true" />
              {t("trades.new")}
            </Button>
          ) : null
        }
      />

      {data.rows.length === 0 ? (
        <Card>
          <EmptyState title={t("trades.empty.title")} text={t("trades.empty.text")} />
        </Card>
      ) : (
        <Card
          title={t("trades.balance", { amount: moneyText(toDbAmount(net)) })}
          description={t("trades.balanceHint")}
        >
          <div className="flex flex-col gap-4">
            <Field label={t("trades.asset")}>
              <Select
                value={assetId ?? ""}
                onChange={(event) =>
                  router.push(
                    event.target.value
                      ? `/app/investimentos/lancamentos?ativo=${event.target.value}`
                      : "/app/investimentos/lancamentos",
                  )
                }
              >
                <option value="">{t("trades.all")}</option>
                {data.rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.ticker ?? row.name}
                  </option>
                ))}
              </Select>
            </Field>
            {lines.length === 0 ? (
              <p className="m-0 text-sm text-muted">{t("trades.emptyAsset")}</p>
            ) : (
              <ul aria-label={t("trades.list")} className="m-0 list-none divide-y divide-line p-0">
                {lines.map(({ row, trade }) => {
                  const unit = isUnitPriced(row.assetClass);
                  const buying = trade.side === "compra";
                  const total = money(trade.quantity).times(trade.unitPrice);
                  const details = [
                    formatDate(trade.occurredOn, locale),
                    unit
                      ? t("trades.detail", {
                          quantity: quantityText(trade.quantity, locale),
                          price: moneyText(trade.unitPrice),
                        })
                      : null,
                    money(trade.fees).gt(0)
                      ? t("trades.fees", { amount: moneyText(trade.fees) })
                      : null,
                    trade.accountName ? system.name(trade.accountName) : null,
                  ];
                  return (
                    <li key={trade.id} className="flex items-center gap-3 py-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="m-0 break-words font-medium">
                          {t(`trade.${sideKey(unit, buying)}`)} · {row.ticker ?? row.name}
                        </p>
                        <p className="m-0 text-xs text-muted">
                          {details.filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <p className="m-0 whitespace-nowrap font-medium tabular-nums">
                        {buying ? "" : "-"}
                        {moneyText(toDbAmount(total))}
                      </p>
                      {writable ? (
                        <IconButton
                          label={t("trades.deleteLabel")}
                          onClick={() => setRemoving(trade)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </IconButton>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      )}

      <Sheet open={adding !== null} onClose={close} title={t("trades.new")}>
        <div className="flex flex-col gap-4">
          <Field label={t("trades.investment")}>
            <Select value={target} onChange={(event) => setTarget(event.target.value)}>
              {data.rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.ticker ?? row.name}
                </option>
              ))}
            </Select>
          </Field>
          {selected ? (
            <TradeForm
              key={`${adding?.nonce}-${selected.id}`}
              row={selected}
              accounts={data.accounts}
              today={data.today}
              onDone={close}
            />
          ) : null}
        </div>
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("trades.remove.title")}
        text={t("trades.remove.text")}
        confirmLabel={t("trades.remove.confirm")}
        action={deleteTrade}
        hidden={{ id: removing?.id ?? "" }}
      />
    </>
  );
}
