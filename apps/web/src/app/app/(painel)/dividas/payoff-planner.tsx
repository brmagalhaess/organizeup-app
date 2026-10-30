"use client";
import { AlertCircle, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import {
  formatBRL,
  money,
  parseBRL,
  simulatePayoff,
  toDbAmount,
  type PayoffDebt,
  type PayoffResult,
} from "@organizeup/domain";
import { Badge, Card, Field, Input } from "@/components/ui";

function duration(months: number) {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "ano" : "anos"}`);
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? "mês" : "meses"}`);
  return parts.join(" e ") || "este mês";
}

function Result({
  title,
  text,
  result,
  baseline,
  best,
}: {
  title: string;
  text: string;
  result: PayoffResult;
  baseline: PayoffResult;
  best: boolean;
}) {
  const saved = toDbAmount(money(baseline.totalInterest).minus(result.totalInterest));
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-xl border border-line bg-card-soft p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        {best ? (
          <Badge tone="success">
            <Sparkles className="size-3" aria-hidden="true" />
            Paga menos juros
          </Badge>
        ) : null}
      </div>
      <p className="text-sm text-muted">{text}</p>
      {result.focus ? (
        <p className="text-sm">
          Comece por <span className="font-semibold">{result.focus.name}</span>
        </p>
      ) : null}
      {result.stalled ? (
        <p className="flex items-start gap-2 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Com esse valor a dívida não termina, porque a parcela não cobre os juros.
        </p>
      ) : (
        <dl className="m-0 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted">Tudo quitado em</dt>
            <dd className="m-0 font-semibold">{duration(result.months)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Juros até o fim</dt>
            <dd className="m-0 font-semibold tabular-nums">{formatBRL(result.totalInterest)}</dd>
          </div>
          {!money(saved).isZero() ? (
            <div className="col-span-2">
              <dt className="text-xs text-muted">Economia frente a só pagar as parcelas</dt>
              <dd className="m-0 font-semibold tabular-nums">{formatBRL(saved)}</dd>
            </div>
          ) : null}
        </dl>
      )}
      <p className="text-xs text-muted">Quando cada uma termina</p>
      <ol className="m-0 list-none space-y-1 p-0 text-sm">
        {result.order.map((item) => (
          <li key={item.id} className="flex justify-between gap-3">
            <span className="truncate">{item.name}</span>
            <span className="whitespace-nowrap text-xs text-muted">{duration(item.month)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Compara as duas ordens de quitação. É uma estimativa, não muda nenhuma parcela. */
export function PayoffPlanner({ debts }: { debts: PayoffDebt[] }) {
  const [extra, setExtra] = useState("");

  const value = useMemo(() => {
    try {
      const parsed = extra.trim() ? parseBRL(extra) : money(0);
      return parsed.lt(0) ? null : toDbAmount(parsed);
    } catch {
      return null;
    }
  }, [extra]);

  const results = useMemo(
    () =>
      value === null
        ? null
        : {
            baseline: simulatePayoff(debts, "0", "minimum"),
            avalanche: simulatePayoff(debts, value, "avalanche"),
            snowball: simulatePayoff(debts, value, "snowball"),
          },
    [debts, value],
  );

  return (
    <Card
      title="Qual dívida pagar primeiro"
      description="Estimativa com o que você tem hoje. Quando uma dívida acaba, a parcela dela reforça a próxima."
    >
      <div className="max-w-xs">
        <Field
          label="Quanto a mais por mês (R$)"
          hint="Além das parcelas."
          error={value === null ? "Informe um valor como 300,00." : undefined}
        >
          <Input
            inputMode="decimal"
            placeholder="0,00"
            value={extra}
            onChange={(event) => setExtra(event.target.value)}
          />
        </Field>
      </div>
      {results ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Result
            title="Maiores juros primeiro"
            text="Conhecida como avalanche. Costuma sair mais barato."
            result={results.avalanche}
            baseline={results.baseline}
            best={money(results.avalanche.totalInterest).lt(results.snowball.totalInterest)}
          />
          <Result
            title="Menor dívida primeiro"
            text="Conhecida como bola de neve. Elimina dívidas mais rápido, o que ajuda a manter o ritmo."
            result={results.snowball}
            baseline={results.baseline}
            best={money(results.snowball.totalInterest).lt(results.avalanche.totalInterest)}
          />
        </div>
      ) : null}
    </Card>
  );
}
