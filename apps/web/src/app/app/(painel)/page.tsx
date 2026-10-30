import { AlertCircle, ArrowRight, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { canWrite } from "@organizeup/db";
import {
  formatBRL,
  formatShortDate,
  formatYearMonth,
  money,
  percentChange,
  percentOf,
  toDbAmount,
  yearMonthOf,
} from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
import { Badge, Button, Card, EmptyState, PageHeader, StatTile } from "@/components/ui";
import { loadOverview } from "@/lib/finance-data";
import { requireTenant } from "@/lib/session";
import { CashflowChart } from "./cashflow-chart";
import { FirstSteps } from "./first-steps";
import { confirmEntry } from "./lancamentos/actions";

export const metadata: Metadata = { title: "Painel" };

/** Compara com o mês anterior em texto, sem depender de cor. */
function comparison(current: string, previous: string) {
  const change = percentChange(current, previous);
  if (change === null) return "Sem base no mês anterior";
  if (change === 0) return "Igual ao mês anterior";
  return `${Math.abs(change)}% ${change > 0 ? "a mais" : "a menos"} que no mês anterior`;
}

function DueBadge({ overdue }: { overdue: boolean }) {
  return overdue ? (
    <Badge tone="danger">
      <AlertCircle className="size-3" aria-hidden="true" />
      Atrasado
    </Badge>
  ) : (
    <Badge>
      <Clock className="size-3" aria-hidden="true" />
      Previsto
    </Badge>
  );
}

export default async function OverviewPage() {
  const { session, ctx } = await requireTenant();
  const data = await loadOverview(ctx);
  const writable = canWrite(ctx);
  const firstName = session.user.name.split(" ")[0];
  const dateLabel = new Date(`${data.today}T12:00:00Z`).toLocaleDateString("pt-BR", {
    dateStyle: "long",
    timeZone: "UTC",
  });

  const top = data.byCategory.slice(0, 6);
  const rest = data.byCategory.slice(6).reduce((acc, c) => acc.plus(c.amount), money(0));
  const bars = [
    ...top.map((c) => ({
      id: c.categoryId,
      name: data.categoryNames.get(c.categoryId) ?? "Sem categoria",
      amount: c.amount,
    })),
    ...(rest.isZero() ? [] : [{ id: "outras", name: "Outras", amount: toDbAmount(rest) }]),
  ];
  const spentTotal = toDbAmount(data.byCategory.reduce((acc, c) => acc.plus(c.amount), money(0)));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Olá, ${firstName}`}
        description={`Hoje é ${dateLabel}${data.place ? ` · ${data.place}` : ""}`}
        actions={
          <Link href="/app/lancamentos" className={buttonClass("secondary")}>
            Ver lançamentos
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        }
      />

      <FirstSteps checklist={data.checklist} />

      <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile
          label="Saldo nas contas"
          value={formatBRL(data.total)}
          hint="Saldo inicial mais o que já foi realizado."
        />
        <StatTile
          label="Entrou"
          value={formatBRL(data.summary.received)}
          hint={comparison(data.summary.received, data.previousSummary.received)}
        />
        <StatTile
          label="Saiu"
          value={formatBRL(data.summary.spent)}
          hint={comparison(data.summary.spent, data.previousSummary.spent)}
        />
        <StatTile
          label="Previsão para o fim do mês"
          value={formatBRL(data.summary.projectedBalance)}
          hint="Resultado de entradas e saídas do mês."
        />
      </dl>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="Entradas e saídas" description="Últimos 6 meses, só o que já aconteceu.">
          <CashflowChart series={data.series} />
        </Card>

        <Card title="Próximos vencimentos" description="O que ainda está em aberto.">
          {data.pending.length === 0 ? (
            <EmptyState
              title="Nada em aberto"
              text="Contas e receitas previstas aparecem aqui até serem confirmadas."
            />
          ) : (
            <ul
              className="m-0 list-none divide-y divide-line p-0"
              aria-label="Próximos vencimentos"
            >
              {data.pending.map((entry) => (
                <li key={`${entry.key}:${entry.date}`} className="flex items-center gap-3 py-2.5">
                  <span className="w-12 shrink-0 text-sm tabular-nums text-muted">
                    {formatShortDate(entry.date)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.description}</p>
                    <p className="text-xs tabular-nums text-muted">
                      {entry.kind === "receita" ? "+ " : "− "}
                      {formatBRL(entry.amount)}
                    </p>
                    <div className="mt-1 sm:hidden">
                      <DueBadge overdue={entry.overdue} />
                    </div>
                  </div>
                  <div className="hidden sm:block">
                    <DueBadge overdue={entry.overdue} />
                  </div>
                  {writable ? (
                    <form action={confirmEntry}>
                      <input type="hidden" name="key" value={entry.key} />
                      <input type="hidden" name="month" value={yearMonthOf(entry.date)} />
                      <Button type="submit" variant="secondary" small>
                        {entry.kind === "receita" ? "Receber" : "Pagar"}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Para onde vai o dinheiro"
        description={`Despesas de ${formatYearMonth(data.month)}, pagas e previstas.`}
      >
        {bars.length === 0 ? (
          <EmptyState
            title="Nenhuma despesa neste mês"
            text="Lance suas despesas para ver em que categorias o dinheiro está indo."
          />
        ) : (
          <ul className="m-0 grid list-none gap-x-10 gap-y-3 p-0 lg:grid-cols-2">
            {bars.map((bar) => (
              <li key={bar.id}>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="truncate">{bar.name}</span>
                  <span className="whitespace-nowrap tabular-nums text-muted">
                    {formatBRL(bar.amount)} · {Math.round(percentOf(bar.amount, spentTotal))}%
                  </span>
                </div>
                <div aria-hidden="true" className="mt-1 h-2 rounded-full bg-brand-50">
                  <div
                    className="h-full rounded-full bg-expense"
                    style={{ width: `${percentOf(bar.amount, spentTotal)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
