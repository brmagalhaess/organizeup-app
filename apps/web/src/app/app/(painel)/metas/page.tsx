import { moduleInvite } from "@/lib/billing/module-invite";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import { Insights } from "@/components/insights/insights";
import { loadGoals } from "@/lib/goals";
import { requireTenant } from "@/lib/session";
import { GoalsBoard } from "./goals-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metas");
  return { title: t("metaTitle") };
}

export default async function GoalsPage() {
  const invite = await moduleInvite("metas");
  if (invite) return invite;
  const { ctx } = await requireTenant();
  const data = await loadGoals(ctx);
  return <GoalsBoard data={data} writable={canWrite(ctx)} insights={<Insights screen="metas" />} />;
}
