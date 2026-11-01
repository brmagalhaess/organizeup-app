"use client";
import { Building2, Car, Package, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { formatBRL, money } from "@organizeup/domain";
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
import type { loadNetWorth } from "@/lib/wealth";
import { deleteAsset, saveAsset, type AssetFormState } from "./actions";
import { NetWorthChart } from "./net-worth-chart";

type Data = Awaited<ReturnType<typeof loadNetWorth>>;
type Asset = Data["assets"][number];

const KINDS = {
  imovel: { label: "Imóvel", icon: Building2 },
  veiculo: { label: "Veículo", icon: Car },
  outro: { label: "Outro bem", icon: Package },
} as const;

const initial: AssetFormState = { ok: false, message: null };

const fullDate = (date: string) => date.split("-").reverse().join("/");

function AssetForm({
  asset,
  data,
  onDone,
}: {
  asset: Asset | null;
  data: Data;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(saveAsset, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={asset?.id ?? ""} />
      <Field label="Nome do bem">
        <Input
          name="name"
          required
          maxLength={80}
          placeholder="Ex.: Apartamento"
          defaultValue={asset?.name}
        />
      </Field>
      <Field label="Tipo">
        <Select name="kind" defaultValue={asset?.kind ?? "imovel"}>
          {Object.entries(KINDS).map(([value, { label }]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-[3fr_2fr] gap-3">
        <Field label="Valor hoje (R$)" hint="Quanto você venderia.">
          <Input
            name="value"
            inputMode="decimal"
            required
            placeholder="0,00"
            defaultValue={asset?.value.replace(".", ",")}
          />
        </Field>
        <Field label="Data do valor">
          <Input
            name="valuedOn"
            type="date"
            required
            defaultValue={asset?.valuedOn ?? data.today}
          />
        </Field>
      </div>
      {data.debtOptions.length > 0 ? (
        <Field label="Dívida ligada a este bem" hint="Opcional. Mostra quanto já é realmente seu.">
          <Select name="linkedDebtId" defaultValue={asset?.linkedDebtId ?? ""}>
            <option value="">Nenhuma</option>
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
        {pending ? "Salvando…" : "Salvar bem"}
      </Button>
    </form>
  );
}

function Row({ name, value, hint }: { name: string; value: string; hint?: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="min-w-0">
        <p>{name}</p>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
      <span className="whitespace-nowrap font-medium tabular-nums">{formatBRL(value)}</span>
    </li>
  );
}

export function NetWorthBoard({ data, writable }: { data: Data; writable: boolean }) {
  const [editing, setEditing] = useState<{ nonce: number; asset: Asset | null } | null>(null);
  const [removing, setRemoving] = useState<Asset | null>(null);
  const close = () => setEditing(null);
  const open = (asset: Asset | null) => setEditing((s) => ({ nonce: (s?.nonce ?? 0) + 1, asset }));
  const { summary } = data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Patrimônio líquido"
        title={formatBRL(summary.net)}
        description="O que você tem menos o que você deve."
        actions={
          writable ? (
            <Button variant="secondary" onClick={() => open(null)}>
              <Plus className="size-4" aria-hidden="true" />
              Novo bem
            </Button>
          ) : null
        }
      />

      <FxNote fx={data.fx} />
      <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile label="O que você tem" value={formatBRL(summary.owned)} />
        <StatTile label="O que você deve" value={formatBRL(summary.owed)} />
        <StatTile
          label="Bens"
          value={formatBRL(summary.assets)}
          hint="Valores informados por você."
        />
        <StatTile
          label="Cartões"
          value={formatBRL(summary.cards)}
          hint="Faturas em aberto e parcelas futuras."
        />
      </dl>

      <Card title="Evolução" description="Uma foto por mês, nos últimos 12 meses.">
        <NetWorthChart points={data.history} />
      </Card>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Card title="O que você tem">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Contas</h3>
          <ul aria-label="Contas" className="m-0 list-none divide-y divide-line p-0">
            {data.accounts.map((account) => (
              <Row key={account.id} name={account.name} value={account.balance} />
            ))}
          </ul>

          {money(summary.investments).gt(0) ? (
            <>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
                Investimentos
              </h3>
              <ul aria-label="Investimentos" className="m-0 list-none divide-y divide-line p-0">
                <Row name="Carteira" value={summary.investments} />
              </ul>
            </>
          ) : null}

          {money(summary.goals).gt(0) ? (
            <>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
                <Link href="/app/metas" className="underline-offset-2 hover:underline">
                  Metas
                </Link>
              </h3>
              <ul aria-label="Metas" className="m-0 list-none divide-y divide-line p-0">
                <Row name="Guardado para metas" value={summary.goals} />
              </ul>
            </>
          ) : null}

          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Bens</h3>
          {data.assets.length === 0 ? (
            <div className="mt-2 flex flex-col items-start gap-2 text-sm text-muted">
              <p>Imóveis, veículos e outros bens entram aqui.</p>
              {writable ? (
                <Button variant="secondary" small onClick={() => open(null)}>
                  Adicionar bem
                </Button>
              ) : null}
            </div>
          ) : (
            <ul aria-label="Bens" className="m-0 list-none divide-y divide-line p-0">
              {data.assets.map((asset) => {
                const { label, icon: Icon } = KINDS[asset.kind];
                return (
                  <li key={asset.id} className="flex items-center gap-3 py-2">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium">{asset.name}</p>
                      <p className="font-medium tabular-nums sm:hidden">{formatBRL(asset.value)}</p>
                      <p className="text-xs text-muted">
                        {label} · valor de {fullDate(asset.valuedOn)}
                      </p>
                      {asset.equity !== null ? (
                        <p className="text-xs text-muted">Já é seu: {formatBRL(asset.equity)}</p>
                      ) : null}
                    </div>
                    <span className="hidden whitespace-nowrap text-sm font-medium tabular-nums sm:block">
                      {formatBRL(asset.value)}
                    </span>
                    {writable ? (
                      <div className="flex shrink-0">
                        <IconButton label={`Editar ${asset.name}`} onClick={() => open(asset)}>
                          <Pencil className="size-4" aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          label={`Excluir ${asset.name}`}
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

        <Card title="O que você deve">
          {data.debts.length === 0 && summary.cardBalances.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma dívida nem compra no cartão em aberto.</p>
          ) : (
            <>
              {data.debts.length > 0 ? (
                <>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    <Link href="/app/dividas" className="underline-offset-2 hover:underline">
                      Dívidas
                    </Link>
                  </h3>
                  <ul aria-label="Dívidas" className="m-0 list-none divide-y divide-line p-0">
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
                      Cartões
                    </Link>
                  </h3>
                  <ul aria-label="Cartões" className="m-0 list-none divide-y divide-line p-0">
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
        title={editing?.asset ? "Editar bem" : "Novo bem"}
      >
        <AssetForm key={editing?.nonce} asset={editing?.asset ?? null} data={data} onDone={close} />
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Excluir bem"
        text={`"${removing?.name ?? ""}" sai do seu patrimônio. Fotos de meses anteriores não mudam.`}
        confirmLabel="Excluir"
        action={deleteAsset}
        hidden={{ id: removing?.id ?? "" }}
      />
    </div>
  );
}
