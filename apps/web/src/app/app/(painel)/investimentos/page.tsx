import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { loadPortfolio } from "@/lib/investments";
import { requireTenant } from "@/lib/session";
import { PortfolioBoard } from "./portfolio-board";

export const metadata: Metadata = { title: "Investimentos" };

export default async function InvestmentsPage() {
  const { ctx } = await requireTenant();
  const data = await loadPortfolio(ctx);
  return <PortfolioBoard data={data} writable={canWrite(ctx)} />;
}
