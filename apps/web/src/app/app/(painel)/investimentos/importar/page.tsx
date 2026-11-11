import { moduleInvite } from "@/lib/billing/module-invite";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { accounts, asc, canWrite, householdCurrency, withHousehold } from "@organizeup/db";
import { brazilRulesApply } from "@organizeup/domain";
import { Card, PageHeader } from "@/components/ui";
import { bankFeedOpen, loadBankConnections } from "@/lib/bank-feed";
import { requireTenant } from "@/lib/session";
import { InvestmentImport } from "./investment-import";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("investimentos.importar");
  return { title: t("metaTitle") };
}

export default async function InvestmentImportPage() {
  const invite = await moduleInvite("investimentos");
  if (invite) return invite;
  const { ctx, session } = await requireTenant();
  const t = await getTranslations("investimentos.importar");
  // Null: não vê a conexão com bancos. Falso: vê, mas ainda não guardou chave.
  const bank =
    canWrite(ctx) && (await bankFeedOpen(session.user))
      ? (await loadBankConnections(ctx)).length > 0
      : null;
  const { accountRows, currency } = await withHousehold(ctx, async (tx) => ({
    accountRows: await tx
      .select({ id: accounts.id, name: accounts.name, archived: accounts.archived })
      .from(accounts)
      .orderBy(asc(accounts.createdAt)),
    currency: await householdCurrency(tx),
  }));
  const blocked = !canWrite(ctx)
    ? t("noPermission")
    : !brazilRulesApply(currency)
      ? t("onlyBrazil")
      : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      {blocked ? (
        <Card>
          <p className="text-sm text-muted">{blocked}</p>
        </Card>
      ) : (
        <InvestmentImport
          bank={bank}
          accounts={accountRows
            .filter((account) => !account.archived)
            .map(({ id, name }) => ({ id, name }))}
        />
      )}
    </div>
  );
}
