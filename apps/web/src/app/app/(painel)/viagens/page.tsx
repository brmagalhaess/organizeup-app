import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { loadTrips } from "@/lib/planning";
import { requireTenant } from "@/lib/session";
import { TripsBoard } from "./trips-board";

export const metadata: Metadata = { title: "Viagens" };

export default async function TripsPage() {
  const { ctx } = await requireTenant();
  const data = await loadTrips(ctx);
  return <TripsBoard data={data} writable={canWrite(ctx)} />;
}
