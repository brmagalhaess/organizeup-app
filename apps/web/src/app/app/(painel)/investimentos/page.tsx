import { STALE_PRICE_DAYS } from "@organizeup/agents";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import { Insights } from "@/components/insights/insights";
import { loadPortfolio } from "@/lib/investments";
import { requireTenant } from "@/lib/session";
import { loadPendingOfKind } from "@/lib/suggestions";
import { PortfolioBoard } from "./portfolio-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("investimentos");
  return { title: t("metaTitle") };
}

export default async function InvestmentsPage() {
  const { ctx } = await requireTenant();
  const [data, suggestions] = await Promise.all([
    loadPortfolio(ctx),
    loadPendingOfKind(ctx, "investimento"),
  ]);
  return (
    <PortfolioBoard
      data={data}
      suggestions={suggestions}
      stalePriceDays={STALE_PRICE_DAYS}
      writable={canWrite(ctx)}
      insights={<Insights screen="investimentos" />}
    />
  );
}
