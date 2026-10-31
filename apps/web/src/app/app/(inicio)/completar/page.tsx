import type { Metadata } from "next";
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
import { isPlanAdult } from "@/lib/onboarding";
import { requireTenant } from "@/lib/session";
import { FamilyStep, GoalStep, RetirementStep, TripsStep } from "./steps";

export const metadata: Metadata = { title: "Completar cadastro" };

const STEPS = ["Sua família", "Aposentadoria", "Viagens", "Primeira meta"];
const DEFAULT_RETIREMENT_AGE = 65;

function currentStep(passo: string | undefined) {
  const step = Number(passo);
  return Number.isInteger(step) && step >= 1 && step <= STEPS.length ? step : 1;
}

const birthValue = (person: { birthYear: number | null; birthMonth: number | null }) =>
  person.birthYear && person.birthMonth
    ? `${person.birthYear}-${String(person.birthMonth).padStart(2, "0")}`
    : "";

const comma = (value: string | null | undefined) => value?.replace(".", ",") ?? "";

export default async function CompletarPage({
  searchParams,
}: {
  searchParams: Promise<{ passo?: string }>;
}) {
  const { ctx } = await requireTenant();
  const panelLink = (
    <Link href="/app" className="text-sm font-semibold text-brand-700 underline">
      Voltar ao painel
    </Link>
  );

  if (!canWrite(ctx)) {
    return (
      <>
        <h1 className="font-display text-2xl font-medium">Completar cadastro</h1>
        <Card>
          <p className="text-sm">Só o responsável ou um adulto pode completar o cadastro.</p>
          <p className="mt-3">{panelLink}</p>
        </Card>
      </>
    );
  }

  const step = currentStep((await searchParams).passo);
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
            Passo {step} de {STEPS.length} · {STEPS[step - 1]}
          </h1>
          <span className="shrink-0">{panelLink}</span>
        </div>
        <progress
          value={step}
          max={STEPS.length}
          aria-label="Progresso do cadastro"
          className="h-2 w-full accent-brand-500"
        />
        <p className="text-sm text-muted">
          Esses dados ficam só na sua família e servem para o plano de aposentadoria.{" "}
          <a
            href="/privacidade"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-brand-700 underline"
          >
            Veja o que mudou.
          </a>
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
                : `Sugerimos ${suggestedYear}, quando ${titular.name} faz ${DEFAULT_RETIREMENT_AGE} anos.`
            }
            targetIncome={comma(plan?.targetIncome)}
            expectedYield={comma(plan?.expectedYield)}
            adults={personRows
              .filter((person) => isPlanAdult(person.relation))
              .map((person) => ({
                id: person.id,
                name: person.name,
                workStatus: person.workStatus ?? "",
                inssContributor: person.inssContributor,
                expectedPension: comma(person.expectedPension),
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
          Voltar ao passo anterior
        </Link>
      ) : null}
    </>
  );
}
