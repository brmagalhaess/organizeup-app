import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import {
  accounts,
  asc,
  canWrite,
  categories,
  desc,
  eq,
  householdCurrency,
  householdReports,
  householdSettings,
  importBatches,
  withHousehold,
} from "@organizeup/db";
import { brazilRulesApply, CARD_CATEGORY, todayIn } from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
import { Card, PageHeader } from "@/components/ui";
import { familyAccountType } from "@/i18n/account-server";
import { agentText } from "@/i18n/agent-text";
import { resolveLocale } from "@/i18n/resolve";
import { systemTextOf } from "@/i18n/system-text";
import { bankFeedOpen, loadBankConnections } from "@/lib/bank-feed";
import { smartImportOpen } from "@/lib/importador/access";
import { requireTenant } from "@/lib/session";
import { ImportWizard } from "./import-wizard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("importar");
  return { title: t("metaTitle") };
}

export default async function ImportPage() {
  const { ctx, session } = await requireTenant();
  const smartImport = await smartImportOpen(session.user);
  // A conexão é de quem está logado: só as contas que esta pessoa ligou aparecem.
  const bankLinks =
    canWrite(ctx) && (await bankFeedOpen(session.user))
      ? (await loadBankConnections(ctx)).flatMap((connection) =>
          connection.links.map((link) => ({ ...link, person: connection.personName })),
        )
      : null;
  const [t, tSystem, locale] = await Promise.all([
    getTranslations("importar"),
    getTranslations("sistema"),
    resolveLocale(),
  ]);
  const system = systemTextOf(tSystem);
  const data = await withHousehold(ctx, async (tx) => {
    const accountRows = await tx
      .select({
        id: accounts.id,
        name: accounts.name,
        archived: accounts.archived,
        currency: accounts.currency,
      })
      .from(accounts)
      .orderBy(asc(accounts.createdAt));
    const categoryRows = await tx
      .select({ id: categories.id, name: categories.name, kind: categories.kind })
      .from(categories)
      .where(eq(categories.archived, false))
      .orderBy(asc(categories.position), asc(categories.name));
    const batchRows = await tx
      .select()
      .from(importBatches)
      .orderBy(desc(importBatches.createdAt))
      .limit(10);
    const reportRows = await tx
      .select({
        period: householdReports.period,
        title: householdReports.title,
        body: householdReports.summary,
        messageKey: householdReports.messageKey,
        messageParams: householdReports.messageParams,
      })
      .from(householdReports)
      .where(eq(householdReports.kind, "importacao"))
      .orderBy(desc(householdReports.createdAt))
      .limit(50);
    const [settings] = await tx
      .select({ timezone: householdSettings.timezone })
      .from(householdSettings)
      .where(eq(householdSettings.householdId, ctx.householdId));
    return {
      accountRows,
      categoryRows,
      batchRows,
      reportRows,
      timezone: settings?.timezone,
      currency: await householdCurrency(tx),
    };
  });
  const accountName = new Map(data.accountRows.map((a) => [a.id, system.name(a.name)]));
  const accountType = await familyAccountType();
  const reportOf = new Map(
    data.reportRows.map((r) => [r.period, agentText(r, locale, accountType)]),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      {canWrite(ctx) && smartImport ? (
        <Card title={t("smart.title")} description={t("smart.text")}>
          <Link href="/app/importar/arquivos" className={buttonClass()}>
            {t("smart.link")}
          </Link>
        </Card>
      ) : null}
      {brazilRulesApply(data.currency) ? (
        <>
          <Card title={t("investments.title")} description={t("investments.text")}>
            <Link href="/app/investimentos/importar" className={buttonClass("secondary")}>
              {t("investments.link")}
            </Link>
          </Card>
          {canWrite(ctx) ? (
            <Card title={t("dividends.title")} description={t("dividends.text")}>
              <Link href="/app/proventos/importar" className={buttonClass("secondary")}>
                {t("dividends.link")}
              </Link>
            </Card>
          ) : null}
        </>
      ) : null}
      {canWrite(ctx) ? (
        <ImportWizard
          accounts={data.accountRows
            .filter((account) => !account.archived)
            .map(({ id, name, currency }) => ({ id, name, currency }))}
          categories={data.categoryRows.filter((category) => category.name !== CARD_CATEGORY)}
          bank={
            bankLinks &&
            bankLinks.flatMap(({ id, name, numberTail, accountId, syncedOn, person }) =>
              accountId && accountName.has(accountId)
                ? [
                    {
                      id,
                      name: `${person}: ${numberTail ? `${name} · ${numberTail}` : name} → ${accountName.get(accountId)}`,
                      accountId,
                      syncedOn,
                    },
                  ]
                : [],
            )
          }
          batches={data.batchRows.map((batch) => ({
            id: batch.id,
            accountName: accountName.get(batch.accountId) ?? t("fallbackAccount"),
            source: batch.source,
            rowCount: batch.rowCount,
            periodStart: batch.periodStart,
            periodEnd: batch.periodEnd,
            createdAt: todayIn(data.timezone, batch.createdAt),
            summary: reportOf.get(batch.id)?.body ?? null,
            summaryTranslated: reportOf.get(batch.id)?.translated ?? false,
          }))}
        />
      ) : (
        <Card>
          <p className="text-sm text-muted">{t("noPermission")}</p>
        </Card>
      )}
    </div>
  );
}
