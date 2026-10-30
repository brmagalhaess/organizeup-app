import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { loadRetirement } from "@/lib/planning";
import { requireTenant } from "@/lib/session";
import { RetirementBoard } from "./retirement-board";

export const metadata: Metadata = { title: "Aposentadoria" };

export default async function RetirementPage() {
  const { ctx } = await requireTenant();
  const data = await loadRetirement(ctx);
  return <RetirementBoard data={data} writable={canWrite(ctx)} />;
}
