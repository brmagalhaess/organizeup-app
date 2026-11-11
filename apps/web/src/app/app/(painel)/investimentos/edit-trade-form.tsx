"use client";
import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { isUnitPriced, money, toDbAmount } from "@organizeup/domain";
import { Button, Field, FormMessage, Input, Select, submitKeeping } from "@/components/ui";
import { AccountField } from "./account-field";
import { updateTrade } from "./actions";
import { initial, toInput, useCloseOnSuccess, type Data, type Row, type Trade } from "./shared";

/** Edição de uma operação já gravada: os mesmos campos do cadastro, preenchidos com o que está no banco. */
export function EditTradeForm({
  row,
  trade,
  accounts,
  onDone,
}: {
  row: Row;
  trade: Trade;
  accounts: Data["accounts"];
  onDone: () => void;
}) {
  const t = useTranslations("investimentos");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [state, action, pending] = useActionState(updateTrade, initial);
  useCloseOnSuccess(state, onDone);
  const unit = isUnitPriced(row.assetClass);
  const amount = toDbAmount(money(trade.quantity).times(trade.unitPrice));
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={trade.id} />
      <input type="hidden" name="investmentId" value={row.id} />
      <p className="m-0 text-sm text-muted">{t("trades.editHint")}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("trade.operation")}>
          <Select name="side" defaultValue={trade.side}>
            <option value="compra">{unit ? t("trade.buy") : t("trade.deposit")}</option>
            <option value="venda">{unit ? t("trade.sell") : t("trade.redeem")}</option>
          </Select>
        </Field>
        <Field label={t("form.date")}>
          <Input name="occurredOn" type="date" required defaultValue={trade.occurredOn} />
        </Field>
      </div>
      {unit ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("form.quantity")}>
            <Input
              name="quantity"
              inputMode="decimal"
              required
              defaultValue={toInput(trade.quantity, locale)}
            />
          </Field>
          <Field label={t("trade.price")}>
            <Input
              name="unitPrice"
              inputMode="decimal"
              required
              defaultValue={toInput(trade.unitPrice, locale)}
            />
          </Field>
        </div>
      ) : (
        <Field label={t("trade.amount")}>
          <Input
            name="amount"
            inputMode="decimal"
            required
            defaultValue={toInput(amount, locale)}
          />
        </Field>
      )}
      <Field label={t("form.fees")} hint={t("trade.feesHint")}>
        <Input name="fees" inputMode="decimal" defaultValue={toInput(trade.fees, locale)} />
      </Field>
      <AccountField accounts={accounts} label={t("account.tradeLabel")} value={trade.accountId} />
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("trade.update")}
      </Button>
    </form>
  );
}
