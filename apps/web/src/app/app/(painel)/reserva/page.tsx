import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { requireTenant } from "@/lib/session";
import { loadReserve } from "@/lib/wealth";
import { ReserveBoard } from "./reserve-board";

export const metadata: Metadata = { title: "Reserva" };

export default async function ReservePage() {
  const { ctx } = await requireTenant();
  const data = await loadReserve(ctx);
  return <ReserveBoard data={data} writable={canWrite(ctx)} />;
}
