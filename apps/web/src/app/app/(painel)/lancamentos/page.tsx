import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { addMonths, formatBRL, formatYearMonth } from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
import { PageHeader, StatTile } from "@/components/ui";
import { loadMonth } from "@/lib/finance-data";
import { requireTenant } from "@/lib/session";
import { EntriesTable } from "./entries-table";

export const metadata: Metadata = { title: "Lançamentos" };

export default async function EntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { ctx } = await requireTenant();
  const { m } = await searchParams;
  const data = await loadMonth(ctx, m);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Lançamentos"
        title={formatYearMonth(data.month)}
        description="Tudo o que entrou, saiu e ainda vai vencer neste mês."
        actions={
          <>
            <Link
              href={`/app/lancamentos?m=${addMonths(data.month, -1)}`}
              aria-label="Mês anterior"
              className={buttonClass("secondary")}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href={`/app/lancamentos?m=${addMonths(data.month, 1)}`}
              aria-label="Próximo mês"
              className={buttonClass("secondary")}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          </>
        }
      />
      <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile label="Entrou" value={formatBRL(data.summary.received)} />
        <StatTile label="Saiu" value={formatBRL(data.summary.spent)} />
        <StatTile label="Sobrou até agora" value={formatBRL(data.summary.balance)} />
        <StatTile
          label="Previsão para o fim do mês"
          value={formatBRL(data.summary.projectedBalance)}
          hint="Conta o que ainda vai entrar e sair."
        />
      </dl>
      <EntriesTable
        month={data.month}
        today={data.today}
        entries={data.entries}
        categories={data.categories.map(({ id, name }) => ({ id, name }))}
        accounts={data.accounts.map(({ id, name }) => ({ id, name }))}
      />
    </div>
  );
}
