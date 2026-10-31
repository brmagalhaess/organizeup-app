import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { PageHeader } from "@/components/ui";
import { loadDividendPlan, loadRetirement } from "@/lib/planning";
import { requireTenant } from "@/lib/session";
import { DividendPlan } from "./dividend-plan";
import { RetirementBoard } from "./retirement-board";

export const metadata: Metadata = { title: "Aposentadoria" };

export default async function RetirementPage() {
  const { ctx } = await requireTenant();
  const [data, dividendPlan] = await Promise.all([loadRetirement(ctx), loadDividendPlan(ctx)]);
  const writable = canWrite(ctx);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Aposentadoria"
        title="Quanto guardar para parar"
        description="Tudo em dinheiro de hoje."
      />
      <DividendPlan data={dividendPlan} writable={writable} />
      <RetirementBoard
        data={data}
        writable={writable}
        startOpen={dividendPlan.plan.status !== "ok" || data.scenarios.length > 0}
      />
    </div>
  );
}
