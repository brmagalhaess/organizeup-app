import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { loadTrips } from "@/lib/planning";
import { requireTenant } from "@/lib/session";
import { loadTripSuggestions } from "@/lib/suggestions";
import { TripsBoard } from "./trips-board";

export const metadata: Metadata = { title: "Viagens" };

export default async function TripsPage() {
  const { ctx } = await requireTenant();
  const [data, suggestions] = await Promise.all([loadTrips(ctx), loadTripSuggestions(ctx)]);
  return <TripsBoard data={data} suggestions={suggestions} writable={canWrite(ctx)} />;
}
