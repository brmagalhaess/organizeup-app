"use client";
import { Target } from "lucide-react";
import { useActionState, useState } from "react";
import { distributeContribution, formatBRL, money, parseBRL } from "@organizeup/domain";
import {
  Button,
  Card,
  EmptyState,
  Field,
  FormMessage,
  Input,
  PageHeader,
  Sheet,
  submitKeeping,
} from "@/components/ui";
import { saveTargets } from "../actions";
import {
  CLASS_LABEL,
  initial,
  percentText,
  toInput,
  useCloseOnSuccess,
  type Data,
} from "../shared";

function TargetsForm({ data, onDone }: { data: Data; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveTargets, initial);
  useCloseOnSuccess(state, onDone);
  const percentOf = (assetClass: string) =>
    toInput(data.targets.find((t) => t.assetClass === assetClass)?.percent ?? null);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Diga quanto da carteira você quer em cada classe. A decisão é sua: o sistema só compara e
        não indica ativo nenhum.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(CLASS_LABEL).map(([value, label]) => (
          <Field key={value} label={`${label} (%)`}>
            <Input
              name={value}
              inputMode="decimal"
              placeholder="0"
              defaultValue={percentOf(value)}
            />
          </Field>
        ))}
      </div>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar metas"}
      </Button>
    </form>
  );
}

function ClassBars({ data }: { data: Data }) {
  return (
    <ul aria-label="Carteira por classe" className="m-0 flex list-none flex-col gap-4 p-0">
      {data.summary.classes.map((share) => {
        const gap = share.toTarget === null ? null : money(share.toTarget);
        return (
          <li key={share.assetClass} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">
                {CLASS_LABEL[share.assetClass] ?? share.assetClass}
              </span>
              <span className="whitespace-nowrap tabular-nums">
                {formatBRL(share.value)} · {percentText(share.percent)}
              </span>
            </div>
            <div className="relative mt-1.5 h-2 rounded-full bg-brand-50" aria-hidden="true">
              <div
                className="h-2 rounded-full bg-brand-500"
                style={{ width: `${Math.min(100, share.percent)}%` }}
              />
              {share.target !== null ? (
                <span
                  className="absolute -top-1 h-4 w-0.5 bg-ink"
                  style={{ left: `${Math.min(100, share.target)}%` }}
                />
              ) : null}
            </div>
            {gap !== null ? (
              <p className="mt-1 text-xs text-muted">
                Meta de {percentText(share.target ?? 0)}:{" "}
                {gap.abs().lt(1)
                  ? "na meta"
                  : gap.gt(0)
                    ? `${formatBRL(gap)} abaixo`
                    : `${formatBRL(gap.abs())} acima`}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function amountOf(text: string): string | null {
  try {
    const value = parseBRL(text);
    return value.gt(0) ? value.toFixed(2) : null;
  } catch {
    return null;
  }
}

/** Divide um aporte entre as classes abaixo da meta. Fala só de classes, nunca de ativo. */
function NextContribution({ data }: { data: Data }) {
  const [text, setText] = useState("");
  const amount = amountOf(text);
  const plan = amount ? distributeContribution(data.summary.classes, amount) : null;
  return (
    <Card
      title="Se você aportar agora"
      description="Mostra como aproximar a carteira das suas metas, sem vender nada."
    >
      <div className="flex flex-col gap-3">
        <Field label="Valor do aporte (R$)">
          <Input
            inputMode="decimal"
            placeholder="1.000,00"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        {plan ? (
          plan.rows.length === 0 ? (
            <p className="m-0 text-sm text-muted">Nenhuma classe com meta está abaixo do alvo.</p>
          ) : (
            <ul aria-label="Divisão do aporte" className="m-0 list-none divide-y divide-line p-0">
              {plan.rows.map((row) => (
                <li key={row.assetClass} className="flex justify-between gap-3 py-2 text-sm">
                  <span>{CLASS_LABEL[row.assetClass] ?? row.assetClass}</span>
                  <span className="font-medium tabular-nums">{formatBRL(row.amount)}</span>
                </li>
              ))}
            </ul>
          )
        ) : null}
        {plan && money(plan.leftover).gt(0) ? (
          <p className="m-0 text-sm text-muted">
            Sobram {formatBRL(plan.leftover)}: as classes já ficam na meta.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

export function RebalanceBoard({ data, writable }: { data: Data; writable: boolean }) {
  const [editing, setEditing] = useState<number | null>(null);
  const close = () => setEditing(null);
  const hasTargets = data.summary.classes.some((share) => share.target !== null);
  return (
    <>
      <PageHeader
        eyebrow="Investimentos"
        title="Balanceamento"
        description="Compare a carteira com a divisão que você escolheu."
        actions={
          writable ? (
            <Button variant="secondary" onClick={() => setEditing((n) => (n ?? 0) + 1)}>
              <Target className="size-4" aria-hidden="true" />
              Metas
            </Button>
          ) : null
        }
      />
      {data.rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Ainda não há carteira para comparar"
            text="Adicione um investimento e defina quanto quer em cada classe."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <Card title="Por classe" description="A marca mostra a sua meta.">
            <ClassBars data={data} />
          </Card>
          {hasTargets ? (
            <NextContribution data={data} />
          ) : (
            <Card>
              <EmptyState
                title="Defina suas metas"
                text="Diga quanto quer em cada classe para ver a diferença e dividir o próximo aporte."
              />
            </Card>
          )}
        </div>
      )}
      <p className="m-0 text-xs text-muted">
        Comparação com as metas que você definiu. Conteúdo educativo, não é recomendação de
        investimento.
      </p>
      <Sheet open={editing !== null} onClose={close} title="Metas por classe">
        <TargetsForm key={editing} data={data} onDone={close} />
      </Sheet>
    </>
  );
}
