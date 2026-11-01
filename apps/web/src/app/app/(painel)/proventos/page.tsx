import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import { Insights } from "@/components/insights/insights";
import { loadDividends } from "@/lib/investments";
import { requireTenant } from "@/lib/session";
import { DividendsBoard } from "./dividends-board";
import { loadDividendOutlook } from "./outlook";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("proventos");
  return { title: t("metaTitle") };
}

export default async function DividendsPage() {
  const { ctx } = await requireTenant();
  const [data, outlook] = await Promise.all([loadDividends(ctx), loadDividendOutlook(ctx)]);
  return (
    <DividendsBoard
      data={data}
      outlook={outlook}
      writable={canWrite(ctx)}
      insights={<Insights screen="proventos" />}
    />
  );
}
