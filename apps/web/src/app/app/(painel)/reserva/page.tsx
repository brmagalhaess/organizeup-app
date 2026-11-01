import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { money } from "@organizeup/domain";
import { Insights } from "@/components/insights/insights";
import { requireTenant } from "@/lib/session";
import { loadDividendPlan } from "@/lib/planning";
import { loadReserve } from "@/lib/wealth";
import { ReserveBoard } from "./reserve-board";

export const metadata: Metadata = { title: "Reserva" };

export default async function ReservePage() {
  const { ctx } = await requireTenant();
  const [data, plan] = await Promise.all([loadReserve(ctx), loadDividendPlan(ctx)]);
  const suggested = money(plan.suggested.reserve).gt(0) ? plan.suggested.reserve : null;
  return (
    <ReserveBoard
      data={data}
      suggested={suggested}
      writable={canWrite(ctx)}
      insights={<Insights screen="reserva" />}
    />
  );
}
