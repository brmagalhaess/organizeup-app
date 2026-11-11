import { moduleInvite } from "@/lib/billing/module-invite";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { yearMonthOf } from "@organizeup/domain";
import { getBrazilRules } from "@/i18n/money-server";
import { isYearMonth } from "@/lib/dividend-calendar";
import { loadDividendCalendar } from "@/lib/dividend-calendar-data";
import { requireTenant } from "@/lib/session";
import { CalendarBoard } from "./calendar-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("investimentos.calendar");
  return { title: t("metaTitle") };
}

/** /app/investimentos/calendario?mes=2026-11&meus=1 */
export default async function DividendCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; meus?: string }>;
}) {
  const invite = await moduleInvite("investimentos");
  if (invite) return invite;
  const { ctx } = await requireTenant();
  if (!(await getBrazilRules())) redirect("/app/investimentos");
  const { mes, meus } = await searchParams;
  const month = isYearMonth(mes) ? mes : yearMonthOf(new Date().toISOString().slice(0, 10));
  const data = await loadDividendCalendar(ctx, month, meus === "1");
  return <CalendarBoard data={data} />;
}
