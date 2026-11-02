import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import { money, toDbAmount } from "@organizeup/domain";
import { FxNote } from "@/components/fx-note";
import { PageHeader } from "@/components/ui";
import { loadAccountBalances, loadTransfers } from "@/lib/finance-data";
import { requireTenant } from "@/lib/session";
import { getMoney } from "@/i18n/money-server";
import { AccountsBoard } from "./accounts-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contas");
  return { title: t("metaTitle") };
}

export default async function AccountsPage() {
  const { ctx } = await requireTenant();
  const [{ accounts: rows, fx, rates }, transfers] = await Promise.all([
    loadAccountBalances(ctx),
    loadTransfers(ctx),
  ]);
  const [t, moneyText] = await Promise.all([getTranslations("contas"), getMoney()]);
  const total = toDbAmount(
    rows.filter((row) => !row.archived).reduce((acc, row) => acc.plus(row.balance), money(0)),
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t("eyebrow")} title={moneyText(total)} description={t("description")} />
      <FxNote fx={fx} />
      <AccountsBoard
        rows={rows}
        moved={transfers.moved}
        rates={rates}
        transfers={transfers.rows}
        today={transfers.today}
        writable={canWrite(ctx)}
      />
    </div>
  );
}
