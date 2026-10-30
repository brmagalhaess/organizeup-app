import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { loadCalendar } from "@/lib/calendar-data";
import { requireTenant } from "@/lib/session";
import { CalendarBoard } from "./calendar-board";

export const metadata: Metadata = { title: "Calendário" };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { ctx } = await requireTenant();
  const { m } = await searchParams;
  const data = await loadCalendar(ctx, m);
  return <CalendarBoard data={data} writable={canWrite(ctx)} />;
}
