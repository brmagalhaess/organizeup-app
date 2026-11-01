import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import { Insights } from "@/components/insights/insights";
import { loadCalendar } from "@/lib/calendar-data";
import { requireTenant } from "@/lib/session";
import { CalendarBoard } from "./calendar-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("calendario");
  return { title: t("metaTitle") };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { ctx } = await requireTenant();
  const { m } = await searchParams;
  const data = await loadCalendar(ctx, m);
  return (
    <CalendarBoard
      data={data}
      writable={canWrite(ctx)}
      insights={<Insights screen="calendario" />}
    />
  );
}
