import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { loadPortfolio } from "@/lib/investments";
import { requireTenant } from "@/lib/session";
import { TradesBoard } from "./trades-board";

export const metadata: Metadata = { title: "Lançamentos de investimentos" };

export default async function InvestmentTradesPage({
  searchParams,
}: {
  searchParams: Promise<{ ativo?: string }>;
}) {
  const { ctx } = await requireTenant();
  const { ativo } = await searchParams;
  const data = await loadPortfolio(ctx);
  return <TradesBoard data={data} assetId={ativo ?? null} writable={canWrite(ctx)} />;
}
