import { moduleInvite } from "@/lib/billing/module-invite";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import { PageHeader } from "@/components/ui";
import { Insights } from "@/components/insights/insights";
import { loadDividendPlan, loadRetirement } from "@/lib/planning";
import { requireTenant } from "@/lib/session";
import { DividendPlan } from "./dividend-plan";
import { RetirementBoard } from "./retirement-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("aposentadoria");
  return { title: t("metaTitle") };
}

export default async function RetirementPage() {
  const invite = await moduleInvite("aposentadoria");
  if (invite) return invite;
  const { ctx } = await requireTenant();
  const [data, dividendPlan, t] = await Promise.all([
    loadRetirement(ctx),
    loadDividendPlan(ctx),
    getTranslations("aposentadoria"),
  ]);
  const writable = canWrite(ctx);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <Insights screen="aposentadoria" />
      <DividendPlan data={dividendPlan} writable={writable} />
      <RetirementBoard
        data={data}
        writable={writable}
        startOpen={dividendPlan.plan.status !== "ok" || data.scenarios.length > 0}
      />
    </div>
  );
}
