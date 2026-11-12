import { Upload } from "lucide-react";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { money } from "@organizeup/domain";
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
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { ctx } = await requireTenant();
  const query = await searchParams;
  const text = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");
  const data = await loadMonth(ctx, text(query.m));
  // O painel abre esta tela já filtrada; o filtro continua sendo só da tela.
  const known = (id: string, list: Array<{ id: string }>) =>
    list.some((row) => row.id === id) ? id : "";
  const filters = {
    kind: ["receita", "despesa", "aporte", "resgate"].includes(text(query.tipo))
      ? text(query.tipo)
      : "",
    category: known(text(query.categoria), data.categories),
    account: known(text(query.conta), data.accounts),
  };
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
          </>
        }
      />
      <Insights screen="lancamentos" />
      {/* Os três números que respondem "como foi o mês"; os outros ficam logo abaixo, menores. */}
      <dl className="m-0 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile
          label={t("stats.received")}
          tone="receita"
          value={moneyText(data.summary.received)}
        />
        <StatTile label={t("stats.spent")} tone="despesa" value={moneyText(data.summary.spent)} />
        <StatTile
          label={t("stats.balance")}
          value={moneyText(data.summary.balance)}
          hint={t("stats.balanceHint")}
        />
      </dl>
      <dl
        aria-label={t("stats.more")}
        className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 rounded-2xl border border-line bg-card-soft px-5 py-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {[
          {
            label: t("stats.forecast"),
            value: data.summary.projectedBalance,
            hint: t("stats.forecastHint"),
          },
          {
            label: t("stats.contributed"),
            value: data.summary.contributed,
            hint: t("stats.contributedHint"),
          },
          {
            label: t("stats.afterContributions"),
            value: data.summary.afterContributions,
            hint: t("stats.afterContributionsHint"),
          },
          ...(money(data.summary.redeemed).isZero()
            ? []
            : [
                {
                  label: t("stats.redeemed"),
                  value: data.summary.redeemed,
                  hint: t("stats.redeemedHint"),
                },
              ]),
        ].map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-xs text-muted">{item.label}</dt>
            <dd className="m-0 mt-0.5">
              <span className="block whitespace-nowrap text-base font-semibold tabular-nums">
                {moneyText(item.value)}
              </span>
              <span className="mt-0.5 block text-xs text-muted">{item.hint}</span>
            </dd>
          </div>
        ))}
      </dl>
      <EntriesTable
        key={`${data.month}:${filters.kind}:${filters.category}:${filters.account}`}
        filters={filters}
        cardLines={data.cardLines}
        month={data.month}
        today={data.today}
        entries={data.entries}
        flows={data.flows}
        savingCategoryIds={data.savingCategoryIds}
        categories={data.categories.map(({ id, name }) => ({ id, name }))}
        accounts={data.accounts.map(({ id, name }) => ({ id, name }))}
      />
    </div>
  );
}
