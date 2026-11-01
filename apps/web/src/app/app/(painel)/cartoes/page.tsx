import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import { isYearMonth } from "@organizeup/domain";
import { loadCards } from "@/lib/commitments";
import { requireTenant } from "@/lib/session";
import { CardsBoard } from "./cards-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("cartoes");
  return { title: t("metaTitle") };
}

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
