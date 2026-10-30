import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { requireTenant } from "@/lib/session";
import { loadNetWorth } from "@/lib/wealth";
import { NetWorthBoard } from "./net-worth-board";

export const metadata: Metadata = { title: "Patrimônio" };

export default async function NetWorthPage() {
  const { ctx } = await requireTenant();
  const data = await loadNetWorth(ctx, { record: true });
  return <NetWorthBoard data={data} writable={canWrite(ctx)} />;
}
