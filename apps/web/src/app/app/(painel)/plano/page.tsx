import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { PlanAction } from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
import { Badge, Card, PageHeader } from "@/components/ui";
import { formatAmount } from "@/i18n/format";
import { loadMonthlyPlan } from "@/lib/planning";
import { requireTenant } from "@/lib/session";
import { systemTextOf } from "@/i18n/system-text";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("plano");
  return { title: t("metaTitle") };
}

const HREF: Record<PlanAction["kind"], string> = {
  completar: "/app/aposentadoria",
  reserva: "/app/reserva",
  divida: "/app/dividas",
  guardar: "/app/aposentadoria",
  gasto: "/app/lancamentos",
};

export default async function PlanPage() {
  const { ctx } = await requireTenant();
  const { actions, targetYear, year } = await loadMonthlyPlan(ctx);
  const [t, tSystem, locale] = await Promise.all([
    getTranslations("plano"),
    getTranslations("sistema"),
    getLocale(),
  ]);
  const system = systemTextOf(tSystem);
  const description =
    year === null
      ? t("description.default")
      : targetYear
        ? t("description.yearTarget", { year: String(year), target: String(targetYear) })
        : t("description.year", { year: String(year) });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={description} />
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {actions.map((action, index) => {
          const title = t(`actions.${action.kind}.title`, {
            amount: action.amount === null ? "" : formatAmount(action.amount, locale),
            category: system.name(action.category ?? ""),
          });
          return (
            <li key={action.kind}>
              <Card title={`${index + 1}. ${title}`} description={t(`actions.${action.kind}.text`)}>
                <div className="flex flex-wrap items-center gap-3">
                  {action.yearsEarlier !== null && action.yearsEarlier > 0 ? (
                    <Badge tone="success">
                      {t("yearsEarlier", { years: action.yearsEarlier })}
                    </Badge>
                  ) : null}
                  <Link href={HREF[action.kind]} className={buttonClass("secondary", true)}>
                    {t(`actions.${action.kind}.link`)}
                  </Link>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
      <p className="m-0 text-sm text-muted">{t("disclaimer")}</p>
    </div>
  );
}
