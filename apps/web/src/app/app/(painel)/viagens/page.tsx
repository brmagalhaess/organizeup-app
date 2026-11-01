import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import { Insights } from "@/components/insights/insights";
import { loadTrips } from "@/lib/planning";
import { requireTenant } from "@/lib/session";
import { loadTripSuggestions } from "@/lib/suggestions";
import { TripsBoard } from "./trips-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("viagens");
  return { title: t("metaTitle") };
}

export default async function TripsPage() {
  const { ctx } = await requireTenant();
  const [data, suggestions] = await Promise.all([loadTrips(ctx), loadTripSuggestions(ctx)]);
  return (
    <TripsBoard
      data={data}
      suggestions={suggestions}
      writable={canWrite(ctx)}
      insights={<Insights screen="viagens" />}
    />
  );
}
