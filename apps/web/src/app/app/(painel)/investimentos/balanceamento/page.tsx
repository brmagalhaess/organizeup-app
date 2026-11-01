import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import { loadPortfolio } from "@/lib/investments";
import { requireTenant } from "@/lib/session";
import { RebalanceBoard } from "./rebalance-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("investimentos");
  return { title: t("metaRebalance") };
}

export default async function RebalancePage() {
  const { ctx } = await requireTenant();
  const data = await loadPortfolio(ctx);
  return <RebalanceBoard data={data} writable={canWrite(ctx)} />;
}
