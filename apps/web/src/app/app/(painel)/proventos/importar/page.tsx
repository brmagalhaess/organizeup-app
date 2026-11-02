import { moduleInvite } from "@/lib/billing/module-invite";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { canWrite, investments, sql, withHousehold } from "@organizeup/db";
import { buttonClass } from "@/components/styles";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { getBrazilRules } from "@/i18n/money-server";
import { requireTenant } from "@/lib/session";
import { DividendImport } from "./dividend-import";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("proventos.importar");
  return { title: t("metaTitle") };
}

export default async function DividendImportPage() {
  const invite = await moduleInvite("investimentos");
  if (invite) return invite;
  const { ctx } = await requireTenant();
  if (!(await getBrazilRules())) redirect("/app/investimentos");
  const t = await getTranslations("proventos.importar");
  const [count] = await withHousehold(ctx, (tx) =>
    tx.select({ value: sql<number>`count(*)::int` }).from(investments),
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/app/proventos" className={buttonClass("secondary")}>
            {t("back")}
          </Link>
        }
      />
      {!canWrite(ctx) ? (
        <Card>
          <p className="text-sm text-muted">{t("noPermission")}</p>
        </Card>
      ) : count?.value ? (
        <DividendImport />
      ) : (
        <Card>
          <EmptyState
            title={t("noInvestments.title")}
            text={t("noInvestments.text")}
            action={
              <Link href="/app/investimentos/importar" className={buttonClass("secondary", true)}>
                {t("noInvestments.action")}
              </Link>
            }
          />
        </Card>
      )}
    </div>
  );
}
