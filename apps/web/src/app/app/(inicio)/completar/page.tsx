import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import {
  accounts,
  asc,
  canWrite,
  ensureFinanceDefaults,
  eq,
  householdSettings,
  people,
  retirementPlan,
  withHousehold,
} from "@organizeup/db";
import { buttonClass } from "@/components/styles";
import { Card } from "@/components/ui";
import { toAmountInput } from "@/i18n/format";
import { vaultReady } from "@/lib/document-vault";
import { identityView } from "@/lib/identity";
import { isPlanAdult } from "@/lib/onboarding";
import { requireTenant } from "@/lib/session";
import { DocumentStep, FamilyStep, GoalStep, RetirementStep, TripsStep } from "./steps";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("familiaOnboarding.complete");
  return { title: t("metaTitle") };
}

const STEPS = ["family", "retirement", "trips", "goal"] as const;
const DEFAULT_RETIREMENT_AGE = 65;

function currentStep(passo: string | undefined) {
  const step = Number(passo);
  return Number.isInteger(step) && step >= 1 && step <= STEPS.length ? step : 1;
}

const birthValue = (person: { birthYear: number | null; birthMonth: number | null }) =>
  person.birthYear && person.birthMonth
    ? `${person.birthYear}-${String(person.birthMonth).padStart(2, "0")}`
    : "";

export default async function CompletarPage({
  searchParams,
}: {
  searchParams: Promise<{ passo?: string }>;
}) {
  const { session, ctx } = await requireTenant();
  const [t, locale, { passo }] = await Promise.all([
    getTranslations("familiaOnboarding.complete"),
    getLocale(),
    searchParams,
  ]);
  const fieldValue = (value: string | null | undefined) =>
    value ? toAmountInput(value, locale) : "";
  const panelLink = (
    <Link href="/app" className="text-sm font-semibold text-brand-700 underline">
      {t("backToPanel")}
    </Link>
  );

  // O documento é da pessoa: vale para qualquer papel na família, antes do resto do cadastro.
  const identity = await identityView(session.user.id);
  const wantsDocument =
    passo === "documento" ? identity.canFill : !passo && identity.ask && vaultReady();
  if (wantsDocument) {
    const tStep = await getTranslations("identity.step");
    return (
      <>
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="font-display text-2xl font-medium">{tStep("title")}</h1>
            <span className="shrink-0">{panelLink}</span>
          </div>
          <p className="text-sm text-muted">{tStep("text")}</p>
        </div>
        <Card>
          {vaultReady() ? <DocumentStep /> : <p className="text-sm">{tStep("unavailable")}</p>}
        </Card>
      </>
    );
  }

  if (!canWrite(ctx)) {
    return (
      <>
        <h1 className="font-display text-2xl font-medium">{t("title")}</h1>
        <Card>
          <p className="text-sm">{t("adultsOnly")}</p>
          <p className="mt-3">{panelLink}</p>
        </Card>
      </>
    );
  }

  const step = currentStep(passo);
  const { settings, plan, personRows, accountRows } = await withHousehold(ctx, async (tx) => {
    if (step === 4) await ensureFinanceDefaults(tx, ctx.householdId);
    const [settings] = await tx
      .select()
      .from(householdSettings)
      .where(eq(householdSettings.householdId, ctx.householdId));
    const [plan] = await tx.select().from(retirementPlan);
    const personRows = await tx.select().from(people).orderBy(asc(people.createdAt));
    const accountRows = await tx
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(eq(accounts.archived, false))
      .orderBy(asc(accounts.createdAt));
    return { settings, plan, personRows, accountRows };
  });

  const titular = personRows.find((person) => person.relation === "titular");
  const suggestedYear = titular?.birthYear ? titular.birthYear + DEFAULT_RETIREMENT_AGE : null;

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-display text-2xl font-medium">
            {t("stepTitle", {
              step,
              total: STEPS.length,
              name: t(`steps.${STEPS[step - 1] ?? "family"}`),
            })}
          </h1>
          <span className="shrink-0">{panelLink}</span>
        </div>
        <progress
          value={step}
          max={STEPS.length}
          aria-label={t("progress")}
          className="h-2 w-full accent-brand-500"
        />
        <p className="text-sm text-muted">
          {t.rich("privacy", {
            link: (chunks) => (
              <a
                href="/privacidade"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-brand-700 underline"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </div>

      <Card>
        {step === 1 ? (
          <FamilyStep
            titular={titular ? { name: titular.name, birth: birthValue(titular) } : null}
            others={personRows
              .filter((person) => person.relation !== "titular")
              .map(({ id, name, relation }) => ({ id, name, relation }))}
            wedding={{
              day: settings?.weddingDay ?? null,
              month: settings?.weddingMonth ?? null,
              year: settings?.weddingYear ?? null,
            }}
          />
        ) : null}
        {step === 2 ? (
          <RetirementStep
            retirementYear={settings?.retirementYear ?? suggestedYear}
            suggestion={
              settings?.retirementYear || !titular || !suggestedYear
                ? null
                : t("suggestedYear", {
                    year: String(suggestedYear),
                    name: titular.name,
                    age: DEFAULT_RETIREMENT_AGE,
                  })
            }
            targetIncome={fieldValue(plan?.targetIncome)}
            expectedYield={fieldValue(plan?.expectedYield)}
            adults={personRows
              .filter((person) => isPlanAdult(person.relation))
              .map((person) => ({
                id: person.id,
                name: person.name,
                workStatus: person.workStatus ?? "",
                inssContributor: person.inssContributor,
                expectedPension: fieldValue(person.expectedPension),
              }))}
          />
        ) : null}
        {step === 3 ? (
          <TripsStep
            tripsPerYear={settings?.tripsPerYear ?? 0}
            tripDays={settings?.tripDays ?? null}
          />
        ) : null}
        {step === 4 ? <GoalStep accounts={accountRows} /> : null}
      </Card>

      {step > 1 ? (
        <Link href={`/app/completar?passo=${step - 1}`} className={buttonClass("ghost", true)}>
          {t("previous")}
        </Link>
      ) : null}
    </>
  );
}
