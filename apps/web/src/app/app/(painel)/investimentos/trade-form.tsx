"use client";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { isUnitPriced } from "@organizeup/domain";
import { Button, Field, FormMessage, Input, Select, submitKeeping } from "@/components/ui";
import { AccountField } from "./account-field";
import { addTrade } from "./actions";
import { initial, useCloseOnSuccess, type Data, type Row } from "./shared";

export function TradeForm({
  row,
  accounts,
  today,
  onDone,
}: {
  row: Row;
  accounts: Data["accounts"];
  today: string;
  onDone: () => void;
}) {
  const t = useTranslations("investimentos");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(addTrade, initial);
  useCloseOnSuccess(state, onDone);
  const unit = isUnitPriced(row.assetClass);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="investmentId" value={row.id} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("trade.operation")}>
          <Select name="side" defaultValue="compra">
            <option value="compra">{unit ? t("trade.buy") : t("trade.deposit")}</option>
            <option value="venda">{unit ? t("trade.sell") : t("trade.redeem")}</option>
          </Select>
        </Field>
        <Field label={t("form.date")}>
          <Input name="occurredOn" type="date" required defaultValue={today} />
        </Field>
      </div>
      {unit ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("form.quantity")}>
            <Input name="quantity" inputMode="decimal" required placeholder="100" />
          </Field>
          <Field label={t("trade.price")}>
            <Input
              name="unitPrice"
              inputMode="decimal"
              required
              placeholder={t("form.pricePlaceholder")}
            />
          </Field>
        </div>
      ) : (
        <Field label={t("trade.amount")}>
          <Input
            name="amount"
            inputMode="decimal"
            required
            placeholder={t("form.amountPlaceholder")}
          />
        </Field>
      )}
      <Field label={t("form.fees")} hint={t("trade.feesHint")}>
        <Input name="fees" inputMode="decimal" placeholder={t("form.zeroPlaceholder")} />
      </Field>
      <AccountField accounts={accounts} label={t("account.tradeLabel")} />
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("trade.submit")}
      </Button>
    </form>
  );
}
