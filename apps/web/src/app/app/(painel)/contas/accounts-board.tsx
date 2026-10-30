"use client";
import {
  Archive,
  ArchiveRestore,
  Banknote,
  Landmark,
  Pencil,
  PiggyBank,
  Plus,
  TrendingUp,
} from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { formatBRL } from "@organizeup/domain";
import {
  Button,
  Card,
  Field,
  FormMessage,
  IconButton,
  Input,
  Select,
  Sheet,
} from "@/components/ui";
import { saveAccount, setAccountArchived, type SimpleFormState } from "./actions";

const TYPES = {
  corrente: { label: "Conta corrente", icon: Landmark },
  poupanca: { label: "Poupança", icon: PiggyBank },
  dinheiro: { label: "Dinheiro em espécie", icon: Banknote },
  investimento: { label: "Investimento", icon: TrendingUp },
} as const;

export interface AccountRow {
  id: string;
  name: string;
  type: keyof typeof TYPES;
  openingBalance: string;
  balance: string;
  archived: boolean;
}

const initial: SimpleFormState = { ok: false, message: null };

function AccountForm({ account, onDone }: { account: AccountRow | null; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveAccount, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={account?.id ?? ""} />
      <Field label="Nome da conta">
        <Input
          name="name"
          required
          maxLength={80}
          placeholder="Ex.: Banco do dia a dia"
          defaultValue={account?.name}
        />
      </Field>
      <Field label="Tipo">
        <Select name="type" defaultValue={account?.type ?? "corrente"}>
          {Object.entries(TYPES).map(([value, { label }]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Saldo inicial (R$)"
        hint="Quanto havia na conta antes dos lançamentos daqui. Eles somam e subtraem deste valor."
      >
        <Input
          name="openingBalance"
          inputMode="decimal"
          placeholder="0,00"
          defaultValue={account?.openingBalance.replace(".", ",")}
        />
      </Field>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar conta"}
      </Button>
    </form>
  );
}

export function AccountsBoard({ rows, writable }: { rows: AccountRow[]; writable: boolean }) {
  const [editing, setEditing] = useState<{ nonce: number; account: AccountRow | null } | null>(
    null,
  );
  const active = rows.filter((row) => !row.archived);
  const archived = rows.filter((row) => row.archived);
  const close = () => setEditing(null);
  const open = (account: AccountRow | null) =>
    setEditing((s) => ({ nonce: (s?.nonce ?? 0) + 1, account }));

  return (
    <>
      <ul
        aria-label="Contas"
        className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
      >
        {active.map((account) => {
          const { label, icon: Icon } = TYPES[account.type];
          return (
            <li
              key={account.id}
              className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-5 shadow-card"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{account.name}</p>
                    <p className="text-xs text-muted">{label}</p>
                  </div>
                </div>
                {writable ? (
                  <div className="flex shrink-0">
                    <IconButton label={`Editar ${account.name}`} onClick={() => open(account)}>
                      <Pencil className="size-4" aria-hidden="true" />
                    </IconButton>
                    {active.length > 1 ? (
                      <form action={setAccountArchived}>
                        <input type="hidden" name="id" value={account.id} />
                        <input type="hidden" name="archived" value="true" />
                        <IconButton type="submit" label={`Arquivar ${account.name}`}>
                          <Archive className="size-4" aria-hidden="true" />
                        </IconButton>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <p className="text-2xl font-semibold tabular-nums tracking-tight">
                {formatBRL(account.balance)}
              </p>
            </li>
          );
        })}
        {writable ? (
          <li>
            <button
              type="button"
              onClick={() => open(null)}
              className="flex h-full min-h-32 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-sm font-semibold text-muted transition hover:bg-brand-50 hover:text-ink"
            >
              <Plus className="size-4" aria-hidden="true" />
              Nova conta
            </button>
          </li>
        ) : null}
      </ul>

      {archived.length > 0 ? (
        <Card title="Arquivadas" description="Fora dos formulários e do saldo total.">
          <ul className="m-0 list-none divide-y divide-line p-0">
            {archived.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate text-sm">{account.name}</span>
                {writable ? (
                  <form action={setAccountArchived}>
                    <input type="hidden" name="id" value={account.id} />
                    <input type="hidden" name="archived" value="false" />
                    <IconButton type="submit" label={`Reativar ${account.name}`}>
                      <ArchiveRestore className="size-4" aria-hidden="true" />
                    </IconButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Sheet
        open={editing !== null}
        onClose={close}
        title={editing?.account ? "Editar conta" : "Nova conta"}
      >
        <AccountForm key={editing?.nonce} account={editing?.account ?? null} onDone={close} />
      </Sheet>
    </>
  );
}
