import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { loadPortfolio } from "@/lib/investments";
import { requireTenant } from "@/lib/session";
import { RebalanceBoard } from "./rebalance-board";

export const metadata: Metadata = { title: "Balanceamento" };

export default async function RebalancePage() {
  const { ctx } = await requireTenant();
  const data = await loadPortfolio(ctx);
  return <RebalanceBoard data={data} writable={canWrite(ctx)} />;
}
