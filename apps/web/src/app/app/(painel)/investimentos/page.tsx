import { STALE_PRICE_DAYS } from "@organizeup/agents";
import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { loadPortfolio } from "@/lib/investments";
import { requireTenant } from "@/lib/session";
import { loadPendingOfKind } from "@/lib/suggestions";
import { PortfolioBoard } from "./portfolio-board";

export const metadata: Metadata = { title: "Investimentos" };

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
    />
  );
}
