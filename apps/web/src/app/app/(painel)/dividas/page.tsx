import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import { todayIn, yearMonthOf } from "@organizeup/domain";
import { PageHeader, StatTile } from "@/components/ui";
import { Insights } from "@/components/insights/insights";
import { formatMonthAbbr } from "@/i18n/format";
import { loadDebtFiles, loadDebtPlan, loadDebts } from "@/lib/commitments";
import { requireTenant } from "@/lib/session";
import { DebtPlanCard, DebtPlanError } from "./debt-plan-card";
import { DebtsBoard } from "./debts-board";
import { getMoney } from "@/i18n/money-server";
import { PayoffPlanner } from "./payoff-planner";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dividas");
  return { title: t("metaTitle") };
}

export default async function DebtsPage() {
  const { ctx } = await requireTenant();
  const [data, plan, files] = await Promise.all([
    loadDebts(ctx),
    loadDebtPlan(ctx),
    loadDebtFiles(ctx),
  ]);
  const open = data.debts.filter((debt) => !debt.archived && debt.next);
  const lastDue = data.summary.lastDue;
  const [t, moneyText, locale] = await Promise.all([
    getTranslations("dividas"),
    getMoney(),
    getLocale(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <Insights screen="dividas" />
      {plan === null ? <DebtPlanError /> : null}
      {plan?.plan ? <DebtPlanCard plan={plan.plan} /> : null}
      {open.length > 0 ? (
        <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatTile label={t("stats.balance")} value={moneyText(data.summary.balance)} />
          <StatTile label={t("stats.thisMonth")} value={moneyText(data.summary.thisMonth)} />
          <StatTile
            label={t("stats.interestLeft")}
            value={moneyText(data.summary.interestLeft)}
            {...(open.some((debt) => debt.system === "manual")
              ? { hint: t("stats.interestHint") }
              : {})}
          />
          <StatTile
            label={t("stats.lastDue")}
            value={
              lastDue
                ? t("stats.lastDueValue", {
                    month: formatMonthAbbr(yearMonthOf(lastDue), locale),
                    year: lastDue.slice(0, 4),
                  })
                : t("stats.noInstallments")
            }
          />
        </dl>
      ) : null}
      <DebtsBoard
        data={data}
        writable={canWrite(ctx)}
        files={files.map((file) => ({
          id: file.id,
          debtId: file.debtId,
          fileName: file.fileName,
          mediaType: file.mediaType,
          sizeBytes: file.sizeBytes,
          status: file.status,
          createdAt: todayIn(undefined, file.createdAt),
        }))}
      />
      {open.length > 1 ? (
        <PayoffPlanner
          debts={open.map((debt) => ({
            id: debt.id,
            name: debt.name,
            balance: debt.balance,
            monthlyRate: debt.system === "manual" ? "0" : debt.monthlyRate,
            rankRate: debt.monthlyRate,
            minimum: debt.next!.amount,
          }))}
        />
      ) : null}
    </div>
  );
}
