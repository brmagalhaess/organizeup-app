import { ChevronLeft, ChevronRight, Upload } from "lucide-react";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { addMonths } from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
import { PageHeader, StatTile } from "@/components/ui";
import { Insights } from "@/components/insights/insights";
import { formatMonthYear } from "@/i18n/format";
import { loadMonth } from "@/lib/finance-data";
import { requireTenant } from "@/lib/session";
import { getMoney } from "@/i18n/money-server";
import { EntriesTable } from "./entries-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("lancamentos");
  return { title: t("metaTitle") };
}

export default async function EntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { ctx } = await requireTenant();
  const { m } = await searchParams;
  const data = await loadMonth(ctx, m);
  const [t, moneyText, locale] = await Promise.all([
    getTranslations("lancamentos"),
    getMoney(),
    getLocale(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={formatMonthYear(data.month, locale)}
        description={t("description")}
        actions={
          <>
            <Link href="/app/importar" className={buttonClass("secondary")}>
              <Upload className="size-4" aria-hidden="true" />
              {t("importStatement")}
            </Link>
            <Link
              href={`/app/lancamentos?m=${addMonths(data.month, -1)}`}
              aria-label={t("previousMonth")}
              className={buttonClass("secondary")}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href={`/app/lancamentos?m=${addMonths(data.month, 1)}`}
              aria-label={t("nextMonth")}
              className={buttonClass("secondary")}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          </>
        }
      />
      <Insights screen="lancamentos" />
      <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile
          label={t("stats.received")}
          tone="receita"
          value={moneyText(data.summary.received)}
        />
        <StatTile label={t("stats.spent")} tone="despesa" value={moneyText(data.summary.spent)} />
        <StatTile label={t("stats.balance")} value={moneyText(data.summary.balance)} />
        <StatTile
          label={t("stats.forecast")}
          value={moneyText(data.summary.projectedBalance)}
          hint={t("stats.forecastHint")}
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
