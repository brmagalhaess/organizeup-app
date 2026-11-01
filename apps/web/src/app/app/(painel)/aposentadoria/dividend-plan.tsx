"use client";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState } from "react";
import { money } from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
import {
  Button,
  Card,
  EmptyState,
  Field,
  FormMessage,
  Input,
  StatTile,
  submitKeeping,
} from "@/components/ui";
import { formatAmount, formatPercent, toFieldValue } from "@/i18n/format";
import type { loadDividendPlan } from "@/lib/planning";
import { acceptSavingAmounts, saveRetirementPlan, type FormState } from "./actions";
import { DividendChart } from "./dividend-chart";
import { percentValue } from "./stored-number";

type Data = Awaited<ReturnType<typeof loadDividendPlan>>;

const initial: FormState = { ok: false, message: null };

function SavingHighlight({ data, writable }: { data: Data; writable: boolean }) {
  const t = useTranslations("aposentadoria.saving");
  const tPlan = useTranslations("aposentadoria.plan");
  const locale = useLocale();
  const { suggested, surplus, contribution } = data;
  const [state, action, pending] = useActionState(acceptSavingAmounts, initial);
  const none = money(suggested.total).isZero();
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-card-soft p-5 sm:p-6">
      <div>
        <p className="text-lg font-semibold sm:text-2xl">
          {t.rich("title", {
            amount: formatAmount(suggested.total, locale),
            value: (chunks) => <span className="tabular-nums">{chunks}</span>,
          })}
        </p>
        <p className="mt-1 text-sm tabular-nums">
          {t("split", {
            reserve: formatAmount(suggested.reserve, locale),
            investment: formatAmount(suggested.investment, locale),
          })}
        </p>
      </div>
      {money(suggested.debt).gt(0) ? (
        <p className="text-sm">{t("debt", { amount: formatAmount(suggested.debt, locale) })}</p>
      ) : null}
      <p className="text-xs text-muted">
        {surplus.basis === "previsto"
          ? t("basisPlanned")
          : t("basisActual", { months: surplus.months })}
      </p>
      {none ? (
        <p className="text-sm">{t("none")}</p>
      ) : suggested.accepted ? (
        <p className="text-sm font-medium">{t("accepted")}</p>
      ) : (
        <>
          {data.form.monthlyContribution !== null ? (
            <p className="text-sm">
              {t("current", { amount: formatAmount(contribution, locale) })}
            </p>
          ) : null}
          {writable ? (
            <form onSubmit={submitKeeping(action)} className="flex flex-col gap-2 sm:items-start">
              <input type="hidden" name="reserve" value={suggested.reserve} />
              <input type="hidden" name="investment" value={suggested.investment} />
              <Button type="submit" disabled={pending}>
                {pending ? tPlan("saving") : t("accept")}
              </Button>
              <FormMessage message={state.message} />
            </form>
          ) : null}
        </>
      )}
    </div>
  );
}

function PlanFacts({ data, targetYear }: { data: Data; targetYear: number }) {
  const t = useTranslations("aposentadoria.facts");
  const locale = useLocale();
  const { plan, contribution } = data;
  const amount = (value: string) => formatAmount(value, locale);
  const closes = plan.yearWithContribution;
  const others = money(plan.otherBase).gt(0);

  const yieldHint = () => {
    switch (plan.yieldBasis) {
      case "observado_12m":
        return t("yieldBasis.observed12m");
      case "observado_anualizado":
        return t("yieldBasis.annualized", { months: plan.yieldMonthsBasis ?? 0 });
      case "suspeito":
        return t("yieldBasis.suspicious", {
          percent: percentValue(plan.observedYield ?? "0", locale),
        });
      default:
        return t("yieldBasis.informed");
    }
  };

  const targetHint = () => {
    if (plan.targetBasis === "sem_dados") return undefined;
    return money(plan.otherIncome).gt(0)
      ? t(`targetBasisWithPension.${plan.targetBasis}`, { amount: amount(plan.otherIncome) })
      : t(`targetBasis.${plan.targetBasis}`);
  };

  return (
    <>
      <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile
          label={t("target")}
          value={amount(plan.targetIncome ?? "0")}
          hint={targetHint()}
        />
        <StatTile
          label={t("current")}
          value={amount(plan.currentIncome)}
          hint={t("currentHint", { percent: formatPercent(plan.coverage, locale) })}
        />
        <StatTile
          label={t("yield")}
          value={percentValue(plan.yieldUsed ?? "0", locale)}
          hint={yieldHint()}
        />
        <StatTile
          label={t("required")}
          value={amount(plan.requiredPortfolio ?? "0")}
          hint={
            money(plan.portfolioGap ?? "0").gt(0)
              ? t("requiredGap", { amount: amount(plan.portfolioGap ?? "0") })
              : t("requiredDone")
          }
        />
        <StatTile
          label={t("incomeBase")}
          value={amount(plan.incomeBase)}
          hint={t("incomeBaseHint")}
        />
        <StatTile label={t("otherBase")} value={amount(plan.otherBase)} hint={t("otherBaseHint")} />
      </dl>
      {others ? <p className="text-xs text-muted">{t("otherBaseNote")}</p> : null}

      <Card title={t("untilTitle")}>
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
          <li>
            {closes === null
              ? t("neverCloses", { amount: amount(contribution) })
              : t("closes", { amount: amount(contribution), year: closes })}
          </li>
          {plan.requiredContribution !== null && money(plan.requiredContribution).gt(0) ? (
            <li>
              {t("requiredContribution", {
                year: targetYear,
                amount: amount(plan.requiredContribution),
              })}
            </li>
          ) : null}
          {plan.projectedIncomeAtTarget !== null ? (
            <li>
              {t("projectedIncome", {
                year: targetYear,
                amount: amount(plan.projectedIncomeAtTarget),
              })}
            </li>
          ) : null}
          {plan.pensionsLater.map((pension) => (
            <li key={`${pension.fromYear}-${pension.amount}`}>
              {t("pensionLater", { amount: amount(pension.amount), year: pension.fromYear })}
            </li>
          ))}
        </ul>
        {plan.series.length > 1 ? (
          <div className="mt-4">
            <DividendChart
              points={plan.series}
              targetYear={targetYear}
              required={plan.requiredPortfolio ?? "0"}
            />
          </div>
        ) : null}
      </Card>
    </>
  );
}

function MissingData({ data }: { data: Data }) {
  const t = useTranslations("aposentadoria.missing");
  const { plan, targetYear } = data;
  const noIncome = plan.status === "sem_dados";
  return (
    <div className="flex flex-col gap-3">
      {targetYear === null || noIncome ? (
        <EmptyState
          title={t("planTitle")}
          text={targetYear === null ? t("planNoYear") : t("planNoIncome")}
          action={
            <Link href="/app/completar" className={buttonClass("secondary", true)}>
              {t("planAction")}
            </Link>
          }
        />
      ) : null}
      {plan.status === "sem_yield" ? (
        <EmptyState
          title={t("yieldTitle")}
          text={t("yieldText")}
          action={
            <Link href="/app/proventos" className={buttonClass("secondary", true)}>
              {t("yieldAction")}
            </Link>
          }
        />
      ) : null}
    </div>
  );
}

function PlanForm({ data }: { data: Data }) {
  const t = useTranslations("aposentadoria.plan");
  const locale = useLocale();
  const [state, action, pending] = useActionState(saveRetirementPlan, initial);
  const { form } = data;
  return (
    <Card title={t("formTitle")} description={t("formDescription")}>
      <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("targetIncome")} hint={t("targetIncomeHint")}>
            <Input
              name="targetIncome"
              inputMode="decimal"
              placeholder={t("targetIncomePlaceholder")}
              defaultValue={toFieldValue(form.targetIncome, locale)}
            />
          </Field>
          <Field label={t("expectedYield")} hint={t("expectedYieldHint")}>
            <Input
              name="expectedYield"
              inputMode="decimal"
              placeholder={t("expectedYieldPlaceholder")}
              defaultValue={toFieldValue(form.expectedYield, locale)}
            />
          </Field>
          <Field label={t("contribution")} hint={t("contributionHint")}>
            <Input
              key={form.monthlyContribution ?? ""}
              name="monthlyContribution"
              inputMode="decimal"
              placeholder={t("contributionPlaceholder")}
              defaultValue={toFieldValue(form.monthlyContribution, locale)}
            />
          </Field>
        </div>
        <details className="text-sm">
          <summary className="w-fit cursor-pointer rounded-lg font-medium">{t("advanced")}</summary>
          <div className="mt-3 max-w-sm">
            <Field label={t("growth")} hint={t("growthHint")}>
              <Input
                name="dividendGrowth"
                inputMode="decimal"
                defaultValue={toFieldValue(form.dividendGrowth, locale)}
              />
            </Field>
          </div>
        </details>
        <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function DividendPlan({ data, writable }: { data: Data; writable: boolean }) {
  const t = useTranslations("aposentadoria.plan");
  const { plan, targetYear } = data;
  return (
    <section aria-labelledby="viver-dos-rendimentos" className="flex flex-col gap-4">
      <div>
        <h2 id="viver-dos-rendimentos" className="font-display text-2xl font-medium">
          {t("heading")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("intro")}</p>
      </div>

      {plan.status === "ok" && targetYear !== null ? (
        <>
          <SavingHighlight data={data} writable={writable} />
          <PlanFacts data={data} targetYear={targetYear} />
        </>
      ) : (
        <MissingData data={data} />
      )}

      {writable ? <PlanForm data={data} /> : null}

      <p className="text-xs text-muted">{t("disclaimer")}</p>
    </section>
  );
}
