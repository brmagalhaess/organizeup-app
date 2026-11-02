import {
  canWrite,
  householdCurrency,
  readBillingCatalog,
  readFamilyAccess,
  readMonthUsage,
  readSubscription,
  withHousehold,
} from "@organizeup/db";
import { refundWindowOpen, selectionOfSubscribed, usageLevel } from "@organizeup/domain";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader, StatTile } from "@/components/ui";
import { formatDate } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { stripeKeyMode } from "@/lib/billing/stripe-key";
import { isServiceAdmin, platformFlags, requireTenant } from "@/lib/session";
import { PlanBuilder } from "./plan-builder";
import { SubscriptionPanel } from "./subscription-panel";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assinatura");
  return { title: t("metaTitle") };
}

const dateOf = (value: Date, locale: Locale) =>
  formatDate(value.toISOString().slice(0, 10), locale);

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ assinou?: string }>;
}) {
  const { session, ctx, role } = await requireTenant();
  const flags = await platformFlags();
  const admin = isServiceAdmin(session.user);
  // Chave desligada: a tela de planos fica visível só para o admin.
  if (!flags.billingEnabled && !admin) notFound();

  const [t, locale, { assinou }] = await Promise.all([
    getTranslations("assinatura"),
    getLocale() as Promise<Locale>,
    searchParams,
  ]);
  const [catalog, row, usage, access, main] = await Promise.all([
    readBillingCatalog(),
    readSubscription(ctx),
    readMonthUsage(ctx),
    readFamilyAccess(ctx, flags),
    withHousehold(ctx, householdCurrency),
  ]);
  const subscribed =
    row?.cycle && ["active", "trialing", "past_due"].includes(row.status ?? "") ? row : null;
  const current = subscribed ? selectionOfSubscribed(subscribed.items, subscribed.cycle!) : null;
  const canBuy = role === "owner" && !flags.maintenance;
  const refundable =
    row !== null &&
    Boolean(row.stripeSubscriptionId) &&
    refundWindowOpen({ ...row, now: new Date() });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />

      {admin ? (
        <Card title={t("admin.title")} description={t("admin.text")}>
          <div className="flex flex-wrap gap-2">
            <Badge tone={flags.billingEnabled ? "warning" : "neutral"}>
              {t(flags.billingEnabled ? "admin.on" : "admin.off")}
            </Badge>
            <Badge tone="neutral">{t(`admin.key.${stripeKeyMode()}`)}</Badge>
          </div>
        </Card>
      ) : null}

      {assinou && !subscribed ? (
        <p className="m-0 text-sm" role="status">
          {t("waiting")}
        </p>
      ) : null}

      <Card title={t("status.title")}>
        <div className="flex flex-col gap-3">
          <p className="m-0 text-sm" data-testid="plano-situacao">
            {t(`status.${access.mode}`, {
              date: access.trialEndsAt ? dateOf(access.trialEndsAt, locale) : "",
            })}
          </p>
          {subscribed?.currentPeriodEnd ? (
            <p className="m-0 text-sm text-muted">
              {t(subscribed.cancelAtPeriodEnd ? "status.endsAt" : "status.renewsAt", {
                date: dateOf(subscribed.currentPeriodEnd, locale),
              })}
            </p>
          ) : null}
          {subscribed?.scheduledAt && subscribed.scheduledItems ? (
            <p className="m-0 text-sm text-muted">
              {t("status.scheduled", { date: dateOf(subscribed.scheduledAt, locale) })}
            </p>
          ) : null}
          {usage && (access.entryLimit !== null || access.messageLimit !== null) ? (
            <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {access.entryLimit !== null ? (
                <StatTile
                  label={t("usage.entries")}
                  value={`${usage.entries} / ${access.entryLimit}`}
                  hint={t(`usage.${usageLevel(usage.entries, access.entryLimit)}`)}
                />
              ) : null}
              {access.messageLimit !== null ? (
                <StatTile
                  label={t("usage.messages")}
                  value={`${usage.messages} / ${access.messageLimit}`}
                  hint={t(`usage.${usageLevel(usage.messages, access.messageLimit)}`)}
                />
              ) : null}
            </dl>
          ) : null}
          {!canWrite(ctx) && access.mode === "leitura" ? (
            <p className="m-0 text-sm text-muted">{t("status.exportHint")}</p>
          ) : null}
        </div>
      </Card>

      <PlanBuilder
        catalog={catalog}
        current={current}
        items={subscribed?.items ?? []}
        main={main}
        canBuy={canBuy}
      />

      {subscribed || refundable ? (
        <SubscriptionPanel
          canBuy={canBuy}
          active={subscribed !== null}
          cancelling={subscribed?.cancelAtPeriodEnd ?? false}
          refundable={refundable}
        />
      ) : null}
      <p className="m-0 text-xs text-muted">{t("priceNote")}</p>
    </div>
  );
}
