import {
  canWrite,
  householdCurrency,
  readBillingCatalog,
  readFamilyAccess,
  readMonthUsage,
  readSubscription,
  withHousehold,
} from "@organizeup/db";
import {
  canSubscribe,
  refundWindowOpen,
  selectionOfSubscribed,
  todayIn,
  usageLevel,
} from "@organizeup/domain";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader, StatTile } from "@/components/ui";
import { formatDate } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { canLeave } from "@/lib/billing/actor";
import { stripeKeyMode } from "@/lib/billing/stripe-key";
import { isServiceAdmin, platformFlags, requireTenant } from "@/lib/session";
import { PlanBuilder } from "./plan-builder";
import { SubscriptionPanel } from "./subscription-panel";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assinatura");
  return { title: t("metaTitle") };
}

/** No fuso do serviço: a validade acaba às 23:59 de Brasília, que em UTC já é o dia seguinte. */
const dateOf = (value: Date, locale: Locale) => formatDate(todayIn(undefined, value), locale);

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ assinou?: string }>;
}) {
  const { session, ctx, role } = await requireTenant();
  const flags = await platformFlags();
  const admin = isServiceAdmin(session.user);
  // Chave desligada: a tela de planos fica visível só para o admin, e para quem já paga poder sair.
  const row = await readSubscription(ctx);
  const leaving = canLeave(row, new Date());
  const open = flags.billingEnabled || admin;
  if (!open && !leaving) notFound();

  const [t, locale, { assinou }] = await Promise.all([
    getTranslations("assinatura"),
    getLocale() as Promise<Locale>,
    searchParams,
  ]);
  const [catalog, usage, access, main] = await Promise.all([
    readBillingCatalog(),
    readMonthUsage(ctx),
    readFamilyAccess(ctx, flags),
    withHousehold(ctx, householdCurrency),
  ]);
  const subscribed =
    row?.cycle && ["active", "trialing", "past_due"].includes(row.status ?? "") ? row : null;
  const current = subscribed ? selectionOfSubscribed(subscribed.items, subscribed.cycle!) : null;
  const canManage = role === "owner" && !flags.maintenance;
  const vipFree = !canSubscribe(access);
  const canBuy = canManage && !vipFree;
  // Assinou: vale o que está na Stripe. Ainda não: o desconto concedido entra na primeira cobrança.
  const discount = subscribed ? subscribed.discountPercent : (access.vip?.discountPercent ?? null);
  const vipEnds = access.mode === "vip" && !subscribed ? (access.vip?.endsAt ?? null) : null;
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
            {open
              ? t(`status.${access.mode}`, {
                  date: access.trialEndsAt ? dateOf(access.trialEndsAt, locale) : "",
                })
              : t("status.keptOff")}
          </p>
          {access.vip?.cost === "sem_custo" && access.vip.endsAt ? (
            <p className="m-0 text-sm text-muted">
              {t("status.vipUntil", { date: dateOf(access.vip.endsAt, locale) })}
            </p>
          ) : null}
          {vipEnds && canBuy ? (
            <p className="m-0 text-sm text-muted">
              {t("status.vipSubscribe", { date: dateOf(vipEnds, locale) })}
            </p>
          ) : null}
          {subscribed?.discountPercent ? (
            <p className="m-0 text-sm text-muted">
              {t("status.vipDiscount", { percent: subscribed.discountPercent })}
            </p>
          ) : null}
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

      {open ? (
        <PlanBuilder
          catalog={catalog}
          current={current}
          items={subscribed?.items ?? []}
          main={main}
          canBuy={canBuy}
          vipFree={vipFree}
          discountPercent={discount}
        />
      ) : null}

      {subscribed || refundable ? (
        <SubscriptionPanel
          canBuy={canManage}
          resumable={open}
          active={subscribed !== null}
          cancelling={subscribed?.cancelAtPeriodEnd ?? false}
          refundable={refundable}
        />
      ) : null}
      <p className="m-0 text-xs text-muted">{t("priceNote")}</p>
    </div>
  );
}
