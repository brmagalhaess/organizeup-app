import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import { isYearMonth } from "@organizeup/domain";
import { loadCardStatements } from "@/lib/card-statements";
import { loadCards } from "@/lib/commitments";
import { loadOwnerChoices } from "@/lib/owners";
import Link from "next/link";
import { buttonClass } from "@/components/styles";
import { Card } from "@/components/ui";
import { bankFeedOpen } from "@/lib/bank-feed";
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
  const { ctx, session } = await requireTenant();
  const { c, m } = await searchParams;
  const [data, owners, statements] = await Promise.all([
    loadCards(ctx),
    loadOwnerChoices(ctx),
    loadCardStatements(ctx),
  ]);
  const bank = canWrite(ctx) && (await bankFeedOpen(session.user));
  const t = bank ? await getTranslations("cartoes.bank") : null;
  return (
    <div className="flex flex-col gap-6">
      <CardsBoard
        data={data}
        selectedId={c ?? null}
        month={m && isYearMonth(m) ? m : null}
        writable={canWrite(ctx)}
        owners={owners}
        statements={statements}
      />
      {t ? (
        <Card title={t("title")} description={t("text")}>
          <Link href="/app/contas/conexoes" className={buttonClass("secondary")}>
            {t("link")}
          </Link>
        </Card>
      ) : null}
    </div>
  );
}
