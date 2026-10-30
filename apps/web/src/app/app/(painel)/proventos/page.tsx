import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { loadDividends } from "@/lib/investments";
import { requireTenant } from "@/lib/session";
import { DividendsBoard } from "./dividends-board";

export const metadata: Metadata = { title: "Proventos" };

export default async function DividendsPage() {
  const { ctx } = await requireTenant();
  const data = await loadDividends(ctx);
  return <DividendsBoard data={data} writable={canWrite(ctx)} />;
}
