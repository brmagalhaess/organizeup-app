"use client";
import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEntryDialog } from "@/components/shell/entry-context";
import { cx } from "@/components/styles";
import { Card } from "@/components/ui";

const actionClass = "text-left text-sm font-medium underline-offset-2 hover:underline";

/** Guia do primeiro uso. Some sozinho quando tudo estiver feito. */
export function FirstSteps({
  checklist,
}: {
  checklist: { income: boolean; recurring: boolean; balance: boolean; family: boolean };
}) {
  const { openNew, writable } = useEntryDialog();
  const steps: Array<{ done: boolean; hint: string; action: ReactNode }> = [
    {
      done: checklist.income,
      hint: "Salário, aluguel recebido ou outra entrada.",
      action: (
        <Link href="/app/renda" className={actionClass}>
          Cadastre sua renda
        </Link>
      ),
    },
    {
      done: checklist.recurring,
      hint: "Marque “Repete todo mês” e ela aparece sozinha.",
      action: (
        <button type="button" className={actionClass} onClick={() => openNew("despesa")}>
          Cadastre uma conta fixa
        </button>
      ),
    },
    {
      done: checklist.balance,
      hint: "Assim o painel mostra quanto você tem hoje.",
      action: (
        <Link href="/app/contas" className={actionClass}>
          Informe o saldo das contas
        </Link>
      ),
    },
    {
      done: checklist.family,
      hint: "Cônjuge, filhos e outras pessoas da casa.",
      action: (
        <Link href="/app/familia" className={actionClass}>
          Inclua sua família
        </Link>
      ),
    },
  ];
  const done = steps.filter((step) => step.done).length;
  if (!writable || done === steps.length) return null;

  return (
    <Card title="Primeiros passos" description={`${done} de ${steps.length} concluídos`}>
      <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 2xl:grid-cols-4">
        {steps.map((step, index) => (
          <li
            key={index}
            className={cx(
              "flex gap-3 rounded-xl border border-line p-3",
              step.done && "bg-card-soft",
            )}
          >
            {step.done ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-label="Feito" />
            ) : (
              <Circle className="mt-0.5 size-5 shrink-0 text-muted" aria-label="A fazer" />
            )}
            <div className="min-w-0">
              {step.action}
              <p className="mt-0.5 text-xs text-muted">{step.hint}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
