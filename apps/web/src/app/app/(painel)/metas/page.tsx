import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { Insights } from "@/components/insights/insights";
import { loadGoals } from "@/lib/goals";
import { requireTenant } from "@/lib/session";
import { GoalsBoard } from "./goals-board";

export const metadata: Metadata = { title: "Metas" };

export default async function GoalsPage() {
  const { ctx } = await requireTenant();
  const data = await loadGoals(ctx);
  return <GoalsBoard data={data} writable={canWrite(ctx)} insights={<Insights screen="metas" />} />;
}
