import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { formatBRL, money, toDbAmount } from "@organizeup/domain";
import { FxNote } from "@/components/fx-note";
import { PageHeader } from "@/components/ui";
import { loadAccountBalances, loadTransfers } from "@/lib/finance-data";
import { requireTenant } from "@/lib/session";
import { AccountsBoard } from "./accounts-board";

export const metadata: Metadata = { title: "Contas" };

export default async function AccountsPage() {
  const { ctx } = await requireTenant();
  const [{ accounts: rows, fx, rates }, transfers] = await Promise.all([
    loadAccountBalances(ctx),
    loadTransfers(ctx),
  ]);
  const total = toDbAmount(
    rows.filter((row) => !row.archived).reduce((acc, row) => acc.plus(row.balance), money(0)),
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Contas"
        title={formatBRL(total)}
        description="Soma do saldo das contas ativas."
      />
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
