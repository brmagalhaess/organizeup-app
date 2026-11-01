"use client";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatBRL, isUnitPriced, money, toDbAmount } from "@organizeup/domain";
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
import { deleteTrade } from "../actions";
import { fullDate, quantityText, type Data, type Trade } from "../shared";
import { TradeForm } from "../trade-form";

const sideLabel = (unit: boolean, buying: boolean) =>
  unit ? (buying ? "Compra" : "Venda") : buying ? "Aplicação" : "Resgate";

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
        eyebrow="Investimentos"
        title="Lançamentos"
        description="Tudo o que entrou e saiu da carteira."
        actions={
          writable && data.rows.length > 0 ? (
            <Button variant="secondary" onClick={() => setAdding({ nonce: Date.now() })}>
              <Plus className="size-4" aria-hidden="true" />
              Nova operação
            </Button>
          ) : null
        }
      />

      {data.rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhuma operação ainda"
            text="Adicione um investimento na Carteira e as compras aparecem aqui."
          />
        </Card>
      ) : (
        <Card
          title={`Saldo aplicado no período: ${formatBRL(toDbAmount(net))}`}
          description="Compras menos vendas das operações abaixo."
        >
          <div className="flex flex-col gap-4">
            <Field label="Ativo">
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
                <option value="">Todos</option>
                {data.rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.ticker ?? row.name}
                  </option>
                ))}
              </Select>
            </Field>
            {lines.length === 0 ? (
              <p className="m-0 text-sm text-muted">Nenhuma operação neste ativo.</p>
            ) : (
              <ul aria-label="Operações" className="m-0 list-none divide-y divide-line p-0">
                {lines.map(({ row, trade }) => {
                  const unit = isUnitPriced(row.assetClass);
                  const buying = trade.side === "compra";
                  const total = money(trade.quantity).times(trade.unitPrice);
                  return (
                    <li key={trade.id} className="flex items-center gap-3 py-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="m-0 break-words font-medium">
                          {sideLabel(unit, buying)} · {row.ticker ?? row.name}
                        </p>
                        <p className="m-0 text-xs text-muted">
                          {fullDate(trade.occurredOn)}
                          {unit
                            ? ` · ${quantityText(trade.quantity)} a ${formatBRL(trade.unitPrice)}`
                            : ""}
                          {money(trade.fees).gt(0) ? ` · taxas de ${formatBRL(trade.fees)}` : ""}
                          {trade.accountName ? ` · ${trade.accountName}` : ""}
                        </p>
                      </div>
                      <p className="m-0 whitespace-nowrap font-medium tabular-nums">
                        {buying ? "" : "-"}
                        {formatBRL(toDbAmount(total))}
                      </p>
                      {writable ? (
                        <IconButton label="Excluir operação" onClick={() => setRemoving(trade)}>
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

      <Sheet open={adding !== null} onClose={close} title="Nova operação">
        <div className="flex flex-col gap-4">
          <Field label="Investimento">
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
        title="Excluir operação"
        text="A posição e o preço médio serão recalculados. Se a operação tirou dinheiro de uma conta, o lançamento da conta sai junto."
        confirmLabel="Excluir"
        action={deleteTrade}
        hidden={{ id: removing?.id ?? "" }}
      />
    </>
  );
}
