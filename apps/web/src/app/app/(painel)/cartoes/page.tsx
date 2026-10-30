import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { isYearMonth } from "@organizeup/domain";
import { loadCards } from "@/lib/commitments";
import { requireTenant } from "@/lib/session";
import { CardsBoard } from "./cards-board";

export const metadata: Metadata = { title: "Cartões" };

export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; m?: string }>;
}) {
  const { ctx } = await requireTenant();
  const { c, m } = await searchParams;
  const data = await loadCards(ctx);
  return (
    <CardsBoard
      data={data}
      selectedId={c ?? null}
      month={m && isYearMonth(m) ? m : null}
      writable={canWrite(ctx)}
    />
  );
}
