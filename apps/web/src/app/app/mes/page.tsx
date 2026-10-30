import type { Metadata } from "next";
import Link from "next/link";
import { canWrite } from "@organizeup/db";
import { addMonths, formatBRL, formatYearMonth } from "@organizeup/domain";
import { Card } from "@/components/ui";
import { loadMonth } from "@/lib/month";
import { requireTenant } from "@/lib/session";
import { confirmEntry, deleteEntry, stopPlan } from "./actions";
import { EntryForm } from "./entry-form";

export const metadata: Metadata = { title: "Dinheiro do mês" };

function dayLabel(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

export default async function MonthPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { ctx } = await requireTenant();
  const { m } = await searchParams;
  const data = await loadMonth(ctx, m);
  const writable = canWrite(ctx);
  const categoryName = new Map(data.categories.map((c) => [c.id, c.name]));
  const month = formatYearMonth(data.month);
  const defaultDate = data.today.startsWith(data.month) ? data.today : `${data.month}-01`;

  const totals = [
    { label: "Entrou", value: data.summary.received },
    { label: "Saiu", value: data.summary.spent },
    { label: "Sobrou até agora", value: data.summary.balance },
    { label: "Previsão para o fim do mês", value: data.summary.projectedBalance },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/app/mes?m=${addMonths(data.month, -1)}`}
          aria-label="Mês anterior"
          className="flex size-11 items-center justify-center rounded-lg border border-line bg-card text-lg"
        >
          ‹
        </Link>
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-500">
            Dinheiro do mês
          </p>
          <h1 className="text-2xl font-bold first-letter:uppercase">{month}</h1>
        </div>
        <Link
          href={`/app/mes?m=${addMonths(data.month, 1)}`}
          aria-label="Próximo mês"
          className="flex size-11 items-center justify-center rounded-lg border border-line bg-card text-lg"
        >
          ›
        </Link>
      </div>

      <dl className="m-0 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {totals.map((total) => (
          <div key={total.label} className="rounded-2xl border border-line bg-card p-4">
            <dt className="text-xs text-muted">{total.label}</dt>
            <dd className="m-0 mt-1 text-lg font-semibold tabular-nums">
              {formatBRL(total.value)}
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card title="Lançamentos">
          {data.entries.length === 0 ? (
            <p className="text-sm text-muted">
              Nada por aqui em {month}. Comece pelo salário e pelas contas que se repetem todo mês.
            </p>
          ) : (
            <ul aria-label="Lançamentos do mês" className="m-0 list-none divide-y divide-line p-0">
              {data.entries.map((entry) => (
                <li key={entry.key} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{entry.description}</p>
                      <p className="text-xs text-muted">
                        {dayLabel(entry.date)} ·{" "}
                        {categoryName.get(entry.categoryId) ?? "Sem categoria"}
                        {entry.recurring ? " · Todo mês" : ""}
                        {entry.status === "previsto" ? " · Previsto" : ""}
                      </p>
                    </div>
                    <p
                      className={`shrink-0 text-sm font-semibold tabular-nums ${
                        entry.kind === "receita" ? "text-brand-700" : "text-ink"
                      }`}
                    >
                      {entry.kind === "receita" ? "+ " : "− "}
                      {formatBRL(entry.amount)}
                    </p>
                  </div>
                  {writable ? (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {entry.status === "previsto" ? (
                        <form action={confirmEntry}>
                          <input type="hidden" name="key" value={entry.key} />
                          <input type="hidden" name="month" value={data.month} />
                          <button
                            type="submit"
                            className="min-h-9 rounded-lg bg-brand-900 px-3 font-semibold text-white"
                          >
                            {entry.kind === "receita" ? "Marcar como recebido" : "Marcar como pago"}
                          </button>
                        </form>
                      ) : null}
                      {entry.source === "lancamento" ? (
                        <form action={deleteEntry}>
                          <input type="hidden" name="id" value={entry.id} />
                          <button
                            type="submit"
                            className="min-h-9 rounded-lg border border-line px-3 font-semibold"
                          >
                            Excluir
                          </button>
                        </form>
                      ) : (
                        <form action={stopPlan}>
                          <input type="hidden" name="id" value={entry.id} />
                          <input type="hidden" name="month" value={data.month} />
                          <button
                            type="submit"
                            className="min-h-9 rounded-lg border border-line px-3 font-semibold"
                          >
                            Parar de repetir
                          </button>
                        </form>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          {writable ? (
            <Card title="Novo lançamento">
              <EntryForm
                defaultDate={defaultDate}
                accounts={data.accounts.map((a) => ({ id: a.id, name: a.name }))}
                categories={data.categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
              />
            </Card>
          ) : null}
          {data.byCategory.length > 0 ? (
            <Card title="Para onde vai o dinheiro">
              <ul className="m-0 list-none space-y-2 p-0 text-sm">
                {data.byCategory.map((item) => (
                  <li key={item.categoryId} className="flex justify-between gap-3">
                    <span>{categoryName.get(item.categoryId) ?? "Sem categoria"}</span>
                    <span className="font-semibold tabular-nums">{formatBRL(item.amount)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
