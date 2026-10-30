"use client";
import { ShieldCheck } from "lucide-react";
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  addMonths,
  formatBRL,
  formatYearMonth,
  money,
  monthsToReserve,
  parseBRL,
} from "@organizeup/domain";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormMessage,
  Input,
  PageHeader,
  Sheet,
  StatTile,
} from "@/components/ui";
import type { loadReserve } from "@/lib/wealth";
import { saveReserve, type ReserveFormState } from "./actions";

type Data = Awaited<ReturnType<typeof loadReserve>>;

const initial: ReserveFormState = { ok: false, message: null };

const months = (value: number) =>
  `${value.toLocaleString("pt-BR")} ${value === 1 ? "mês" : "meses"}`;

function basisText(data: Data) {
  const { basis, months: used } = data.baseline;
  if (basis === "informado") return "Valor informado por você.";
  if (basis === "media")
    return used === 1 ? "Gasto do último mês fechado." : `Média dos últimos ${used} meses.`;
  if (basis === "mes_atual") return "Estimativa pelo mês atual, com as previsões.";
  return "Sem lançamentos essenciais ainda.";
}

function ReserveForm({ data, onDone }: { data: Data; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveReserve, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Meta em meses" hint="Um ponto de partida comum é 6 meses.">
        <Input
          name="targetMonths"
          type="number"
          min={1}
          max={60}
          required
          defaultValue={data.targetMonths}
        />
      </Field>
      <Field
        label="Gasto essencial por mês (R$)"
        hint="Opcional. Em branco, calculamos pelos lançamentos em categorias essenciais."
      >
        <Input
          name="monthly"
          inputMode="decimal"
          placeholder="0,00"
          defaultValue={data.informedMonthly?.replace(".", ",")}
        />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Contas que guardam a reserva</legend>
        <div className="flex flex-col gap-1">
          {data.accounts.map((account) => (
            <label key={account.id} className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="accountIds"
                value={account.id}
                defaultChecked={account.selected}
                className="size-5 accent-brand-500"
              />
              <span className="min-w-0 flex-1 truncate">{account.name}</span>
              <span className="tabular-nums text-muted">{formatBRL(account.balance)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar reserva"}
      </Button>
    </form>
  );
}

function TimeToGoal({ data }: { data: Data }) {
  const [text, setText] = useState("");
  const answer = useMemo(() => {
    if (!text.trim()) return null;
    try {
      const value = parseBRL(text);
      if (value.lte(0)) return "invalid";
      return monthsToReserve(data.status.missing, value.toFixed(2));
    } catch {
      return "invalid";
    }
  }, [text, data.status.missing]);

  return (
    <Card title="Quanto tempo falta" description="Simule quanto você consegue guardar por mês.">
      <div className="max-w-xs">
        <Field
          label="Guardar por mês (R$)"
          error={answer === "invalid" ? "Informe um valor como 500,00." : undefined}
        >
          <Input
            inputMode="decimal"
            placeholder="0,00"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
      </div>
      {typeof answer === "number" ? (
        <p className="mt-3 text-sm" role="status">
          Em <span className="font-semibold">{months(answer)}</span> você chega à meta, em{" "}
          {formatYearMonth(addMonths(data.month, answer))}.
        </p>
      ) : null}
    </Card>
  );
}

export function ReserveBoard({ data, writable }: { data: Data; writable: boolean }) {
  const [editing, setEditing] = useState<number | null>(null);
  const close = () => setEditing(null);
  const open = () => setEditing((nonce) => (nonce ?? 0) + 1);
  const { status } = data;
  const selected = data.accounts.filter((account) => account.selected);
  const noBaseline = data.baseline.basis === "sem_dados";
  const done = !noBaseline && money(status.missing).isZero();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Reserva"
        title="Reserva de emergência"
        description="Dinheiro para imprevistos, sem precisar se endividar."
        actions={
          writable ? (
            <Button variant="secondary" onClick={open}>
              Ajustar reserva
            </Button>
          ) : null
        }
      />

      {noBaseline ? (
        <Card>
          <EmptyState
            title="Falta saber seu gasto essencial"
            text="Lance moradia, mercado e contas, ou informe quanto gasta por mês com o essencial. Assim calculamos a meta."
            action={writable ? <Button onClick={open}>Informar gasto essencial</Button> : null}
          />
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-muted">Guardado até agora</p>
                <p className="font-display text-4xl font-medium tabular-nums">
                  {formatBRL(status.saved)}
                </p>
                <p className="mt-1 text-sm text-muted">de {formatBRL(status.target)}</p>
              </div>
              {done ? (
                <Badge tone="success">
                  <ShieldCheck className="size-3" aria-hidden="true" />
                  Meta atingida
                </Badge>
              ) : null}
            </div>
            <div
              role="progressbar"
              aria-label="Progresso da reserva"
              aria-valuenow={status.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-4 h-3 rounded-full bg-brand-50"
            >
              <div
                className="h-full rounded-full bg-brand-500"
                style={{ width: `${status.percent}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-muted">
              {status.percent}% da meta · cobre {months(status.coveredMonths)} de gastos essenciais
            </p>
          </Card>

          <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatTile
              label="Meta"
              value={formatBRL(status.target)}
              hint={`${months(data.targetMonths)} de gastos essenciais.`}
            />
            <StatTile label="Falta" value={formatBRL(status.missing)} />
            <StatTile
              label="Gasto essencial por mês"
              value={formatBRL(data.baseline.monthly)}
              hint={basisText(data)}
            />
            <StatTile
              label="Contas na reserva"
              value={String(selected.length)}
              hint={selected.length === 0 ? "Marque em Ajustar reserva." : undefined}
            />
          </dl>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Onde está guardada">
              {selected.length === 0 ? (
                <EmptyState
                  title="Nenhuma conta marcada"
                  text="Crie uma conta separada para a reserva e marque aqui, ou escolha uma que você já tem."
                  action={
                    writable ? (
                      <Button variant="secondary" onClick={open}>
                        Escolher contas
                      </Button>
                    ) : null
                  }
                />
              ) : (
                <ul
                  aria-label="Contas da reserva"
                  className="m-0 list-none divide-y divide-line p-0"
                >
                  {selected.map((account) => (
                    <li key={account.id} className="flex justify-between gap-3 py-2 text-sm">
                      <span className="truncate">{account.name}</span>
                      <span className="font-medium tabular-nums">{formatBRL(account.balance)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {done ? (
              <Card title="Reserva completa">
                <p className="text-sm text-muted">
                  Sua reserva cobre a meta. O que passar disso pode ir para outros objetivos.
                </p>
              </Card>
            ) : (
              <TimeToGoal data={data} />
            )}
          </div>
        </>
      )}

      <Sheet open={editing !== null} onClose={close} title="Ajustar reserva">
        <ReserveForm key={editing} data={data} onDone={close} />
      </Sheet>
    </div>
  );
}
