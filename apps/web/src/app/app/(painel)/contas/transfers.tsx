"use client";
import { ArrowRight, Trash2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { formatBRL } from "@organizeup/domain";
import {
  Button,
  Card,
  ConfirmSheet,
  Field,
  FormMessage,
  IconButton,
  Input,
  Select,
} from "@/components/ui";
import { createTransfer, deleteTransfer, type SimpleFormState } from "./actions";

export interface TransferRow {
  id: string;
  fromName: string;
  toName: string;
  amount: string;
  occurredOn: string;
  note: string | null;
}

const initial: SimpleFormState = { ok: false, message: null };
const fullDate = (date: string) => date.split("-").reverse().join("/");

export function TransferForm({
  accounts,
  today,
  onDone,
}: {
  accounts: Array<{ id: string; name: string }>;
  today: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(createTransfer, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="De">
          <Select name="fromAccountId" defaultValue={accounts[0]?.id}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Para">
          <Select name="toAccountId" defaultValue={accounts[1]?.id}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor (R$)">
          <Input name="amount" inputMode="decimal" required placeholder="500,00" />
        </Field>
        <Field label="Data">
          <Input name="occurredOn" type="date" required defaultValue={today} />
        </Field>
      </div>
      <Field label="Observação" hint="Opcional.">
        <Input name="note" maxLength={120} />
      </Field>
      <p className="m-0 text-xs text-muted">
        O saldo das duas contas muda. Não conta como gasto nem como receita.
      </p>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Transferindo…" : "Transferir"}
      </Button>
    </form>
  );
}

export function TransferList({ rows, writable }: { rows: TransferRow[]; writable: boolean }) {
  const [removing, setRemoving] = useState<TransferRow | null>(null);
  if (rows.length === 0) return null;
  return (
    <Card title="Transferências recentes">
      <ul aria-label="Transferências" className="m-0 list-none divide-y divide-line p-0">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="m-0 flex flex-wrap items-center gap-1 font-medium">
                {row.fromName}
                <ArrowRight className="size-3.5" aria-label="para" />
                {row.toName}
              </p>
              <p className="m-0 break-words text-xs text-muted">
                {fullDate(row.occurredOn)}
                {row.note ? ` · ${row.note}` : ""}
              </p>
            </div>
            <p className="m-0 whitespace-nowrap font-medium tabular-nums">
              {formatBRL(row.amount)}
            </p>
            {writable ? (
              <IconButton label="Desfazer transferência" onClick={() => setRemoving(row)}>
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            ) : null}
          </li>
        ))}
      </ul>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Desfazer transferência"
        text="O valor volta para a conta de origem."
        confirmLabel="Desfazer"
        action={deleteTransfer}
        hidden={{ id: removing?.id ?? "" }}
      />
    </Card>
  );
}
