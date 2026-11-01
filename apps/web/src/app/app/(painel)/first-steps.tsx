"use client";
import { CheckCircle2, Circle } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEntryDialog } from "@/components/shell/entry-context";
import { cx } from "@/components/styles";
import { Card } from "@/components/ui";

const actionClass = "text-left text-sm font-medium underline-offset-2 hover:underline";

/** Guia do primeiro uso. Some sozinho quando tudo estiver feito. */
export function FirstSteps({
  checklist,
}: {
  checklist: {
    onboarding: boolean;
    income: boolean;
    recurring: boolean;
    balance: boolean;
    family: boolean;
  };
}) {
  const t = useTranslations("dashboard.firstSteps");
  const { openNew, writable } = useEntryDialog();
  const steps: Array<{ done: boolean; hint: string; action: ReactNode }> = [
    {
      done: checklist.onboarding,
      hint: t("onboardingHint"),
      action: (
        <Link href="/app/completar" className={actionClass}>
          {t("onboarding")}
        </Link>
      ),
    },
    {
      done: checklist.income,
      hint: t("incomeHint"),
      action: (
        <Link href="/app/renda" className={actionClass}>
          {t("income")}
        </Link>
      ),
    },
    {
      done: checklist.recurring,
      hint: t("recurringHint"),
      action: (
        <button type="button" className={actionClass} onClick={() => openNew("despesa")}>
          {t("recurring")}
        </button>
      ),
    },
    {
      done: checklist.balance,
      hint: t("balanceHint"),
      action: (
        <Link href="/app/contas" className={actionClass}>
          {t("balance")}
        </Link>
      ),
    },
    {
      done: checklist.family,
      hint: t("familyHint"),
      action: (
        <Link href="/app/familia" className={actionClass}>
          {t("family")}
        </Link>
      ),
    },
  ];
  const done = steps.filter((step) => step.done).length;
  if (!writable || done === steps.length) return null;

  return (
    <Card title={t("title")} description={t("progress", { done, total: steps.length })}>
      <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 2xl:grid-cols-5">
        {steps.map((step, index) => (
          <li
            key={index}
            className={cx(
              "flex gap-3 rounded-xl border border-line p-3",
              step.done && "bg-card-soft",
            )}
          >
            {step.done ? (
              <CheckCircle2
                className="mt-0.5 size-5 shrink-0 text-success"
                aria-label={t("done")}
              />
            ) : (
              <Circle className="mt-0.5 size-5 shrink-0 text-muted" aria-label={t("todo")} />
            )}
            <div className="min-w-0">
              {step.action}
              <p className="mt-0.5 text-xs text-muted">{step.hint}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
