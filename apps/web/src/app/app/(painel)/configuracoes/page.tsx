import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Suspense } from "react";
import { canUseAssistant, INSIGHTS_CONSENT_VERSION } from "@organizeup/ai";
import {
  canWrite,
  eq,
  householdHasMovement,
  householdSettings,
  withHousehold,
} from "@organizeup/db";
import { AssistantSettings } from "@/components/assistant/assistant-settings";
import { buttonClass } from "@/components/styles";
import { LocaleSelect } from "@/components/locale-select";
import { Card, PageHeader } from "@/components/ui";
import { formatInstant } from "@/i18n/format";
import { requireTenant } from "@/lib/session";
import { DeleteAccount } from "./delete-account";
import { MemoriesBlock } from "./memories";
import { CurrencyForm, PlanForm, SettingsForm } from "./settings-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("metaTitle") };
}

const LEGAL_LINK = "font-semibold text-brand-700 underline";

function LoadingMemories() {
  const t = useTranslations("common");
  return <p className="m-0 text-sm text-muted">{t("loadingEllipsis")}</p>;
}

export default async function SettingsPage() {
  const { session, ctx } = await requireTenant();
  const { settings, locked } = await withHousehold(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(householdSettings)
      .where(eq(householdSettings.householdId, ctx.householdId));
    return { settings: row, locked: await householdHasMovement(tx) };
  });
  const [t, tLocale, locale] = await Promise.all([
    getTranslations("settings"),
    getTranslations("locale"),
    getLocale(),
  ]);
  const role = ["owner", "adult", "child", "viewer"].includes(ctx.role)
    ? t(`roles.${ctx.role as "owner"}`)
    : ctx.role;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Card title={t("language.title")} description={t("language.description")}>
          <LocaleSelect hint={tLocale("hint")} />
        </Card>
        <Card title={t("home.title")} description={t("home.description")}>
          <SettingsForm
            disabled={!canWrite(ctx)}
            initial={{
              city: settings?.city ?? "",
              state: settings?.state ?? "",
              timezone: settings?.timezone ?? "America/Sao_Paulo",
            }}
          />
        </Card>
        <Card title={t("currency.title")} description={t("currency.description")}>
          <CurrencyForm
            currency={settings?.mainCurrency ?? "BRL"}
            locked={locked}
            disabled={!canWrite(ctx)}
          />
        </Card>
        <Card title={t("plan.title")} description={t("plan.description")}>
          <PlanForm
            disabled={!canWrite(ctx)}
            values={{
              retirementYear: settings?.retirementYear ?? null,
              tripsPerYear: settings?.tripsPerYear ?? 0,
              tripDays: settings?.tripDays ?? null,
            }}
          />
        </Card>
        <Card title={t("assistant.title")} description={t("assistant.description")}>
          <AssistantSettings
            active={Boolean(settings?.aiConsentAt)}
            acceptedOn={settings?.aiConsentAt ? formatInstant(settings.aiConsentAt, locale) : null}
            autonomy={settings?.aiAutonomy ?? "organizar"}
            canManage={canUseAssistant(ctx)}
            needsInsightsConsent={(settings?.aiConsentVersion ?? "") < INSIGHTS_CONSENT_VERSION}
          />
        </Card>
        <Card title={t("memories.title")} description={t("memories.description")}>
          <Suspense fallback={<LoadingMemories />}>
            <MemoriesBlock ctx={ctx} />
          </Suspense>
        </Card>
        <Card title={t("account.title")}>
          <dl className="m-0 grid gap-3 text-sm">
            <div>
              <dt className="text-muted">{t("account.name")}</dt>
              <dd className="m-0 font-medium">{session.user.name}</dd>
            </div>
            <div>
              <dt className="text-muted">{t("account.email")}</dt>
              <dd className="m-0 font-medium">{session.user.email}</dd>
            </div>
            <div>
              <dt className="text-muted">{t("account.role")}</dt>
              <dd className="m-0 font-medium">{role}</dd>
            </div>
            <div>
              <dt className="text-muted">{t("account.id")}</dt>
              <dd className="m-0 select-all break-all font-mono text-xs">{session.user.id}</dd>
            </div>
          </dl>
        </Card>
        <Card title={t("data.title")} description={t("data.description")}>
          <div className="flex flex-wrap gap-2">
            {ctx.role === "owner" ? (
              <a href="/app/exportar" download className={buttonClass("secondary", true)}>
                {t("data.download")}
              </a>
            ) : null}
            <DeleteAccount />
          </div>
          <p className="mt-4 text-sm text-muted">
            {t.rich("data.legal", {
              terms: (text) => (
                <Link href="/termos" className={LEGAL_LINK}>
                  {text}
                </Link>
              ),
              privacy: (text) => (
                <Link href="/privacidade" className={LEGAL_LINK}>
                  {text}
                </Link>
              ),
            })}
          </p>
        </Card>
      </div>
    </div>
  );
}
