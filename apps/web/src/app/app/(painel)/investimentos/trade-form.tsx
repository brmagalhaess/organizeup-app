"use client";
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
  const [state, action, pending] = useActionState(addTrade, initial);
  useCloseOnSuccess(state, onDone);
  const unit = isUnitPriced(row.assetClass);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="investmentId" value={row.id} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Operação">
          <Select name="side" defaultValue="compra">
            <option value="compra">{unit ? "Compra" : "Aplicação"}</option>
            <option value="venda">{unit ? "Venda" : "Resgate"}</option>
          </Select>
        </Field>
        <Field label="Data">
          <Input name="occurredOn" type="date" required defaultValue={today} />
        </Field>
      </div>
      {unit ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantidade">
            <Input name="quantity" inputMode="decimal" required placeholder="100" />
          </Field>
          <Field label="Preço (R$)">
            <Input name="unitPrice" inputMode="decimal" required placeholder="32,50" />
          </Field>
        </div>
      ) : (
        <Field label="Valor (R$)">
          <Input name="amount" inputMode="decimal" required placeholder="1.000,00" />
        </Field>
      )}
      <Field label="Taxas (R$)" hint="Opcional. Entram no preço médio.">
        <Input name="fees" inputMode="decimal" placeholder="0,00" />
      </Field>
      <AccountField accounts={accounts} label="Conta do dinheiro" />
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar operação"}
      </Button>
    </form>
  );
}
