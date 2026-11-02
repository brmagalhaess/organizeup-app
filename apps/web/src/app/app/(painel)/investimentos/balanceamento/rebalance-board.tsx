"use client";
import { Target } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { distributeContribution, money, parseMoney } from "@organizeup/domain";
import {
  Button,
  Card,
  EmptyState,
  Field,
  FormMessage,
  Input,
  PageHeader,
  Sheet,
  submitKeeping,
} from "@/components/ui";
import type { Locale } from "@/i18n/locales";
import { saveTargets } from "../actions";
import {
  classesFor,
  initial,
  percentText,
  toInput,
  useCloseOnSuccess,
  type AssetClass,
  type Data,
} from "../shared";
import { useFamilyCurrency, useMoney } from "@/i18n/money";

function TargetsForm({ data, onDone }: { data: Data; onDone: () => void }) {
  const t = useTranslations("investimentos");
  const currency = useFamilyCurrency();
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [state, action, pending] = useActionState(saveTargets, initial);
  useCloseOnSuccess(state, onDone);
  const percentOf = (assetClass: string) =>
    toInput(data.targets.find((row) => row.assetClass === assetClass)?.percent ?? null, locale);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t("rebalance.form.intro")}</p>
      <div className="grid grid-cols-2 gap-3">
        {classesFor(currency).map((value) => (
          <Field key={value} label={`${t(`classes.${value}`)} (%)`}>
            <Input
              name={value}
              inputMode="decimal"
              placeholder="0"
              defaultValue={percentOf(value)}
            />
          </Field>
        ))}
      </div>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("rebalance.form.submit")}
      </Button>
    </form>
  );
}

function ClassBars({ data }: { data: Data }) {
  const t = useTranslations("investimentos");
  const locale = useLocale();
  const moneyText = useMoney();
  return (
    <ul aria-label={t("rebalance.byClass.list")} className="m-0 flex list-none flex-col gap-4 p-0">
      {data.summary.classes.map((share) => {
        const gap = share.toTarget === null ? null : money(share.toTarget);
        const percent = percentText(share.target ?? 0, locale);
        return (
          <li key={share.assetClass} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 font-medium">
                {t(`classes.${share.assetClass as AssetClass}`)}
              </span>
              <span className="whitespace-nowrap tabular-nums">
                {moneyText(share.value)} · {percentText(share.percent, locale)}
              </span>
            </div>
            <div className="relative mt-1.5 h-2 rounded-full bg-brand-50" aria-hidden="true">
              <div
                className="h-2 rounded-full bg-brand-500"
                style={{ width: `${Math.min(100, share.percent)}%` }}
              />
              {share.target !== null ? (
                <span
                  className="absolute -top-1 h-4 w-0.5 bg-ink"
                  style={{ left: `${Math.min(100, share.target)}%` }}
                />
              ) : null}
            </div>
            {gap !== null ? (
              <p className="mt-1 text-xs text-muted">
                {gap.abs().lt(1)
                  ? t("rebalance.byClass.onTarget", { percent })
                  : gap.gt(0)
                    ? t("rebalance.byClass.below", {
                        percent,
                        amount: moneyText(gap),
                      })
                    : t("rebalance.byClass.above", {
                        percent,
                        amount: moneyText(gap.abs()),
                      })}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function amountOf(text: string, locale: Locale): string | null {
  try {
    const value = parseMoney(text, locale);
    return value.gt(0) ? value.toFixed(2) : null;
  } catch {
    return null;
  }
}

/** Divide um aporte entre as classes abaixo da meta. Fala só de classes, nunca de ativo. */
function NextContribution({ data }: { data: Data }) {
  const t = useTranslations("investimentos");
  const locale = useLocale();
  const moneyText = useMoney();
  const [text, setText] = useState("");
  const amount = amountOf(text, locale);
  const plan = amount ? distributeContribution(data.summary.classes, amount) : null;
  return (
    <Card title={t("rebalance.next.title")} description={t("rebalance.next.description")}>
      <div className="flex flex-col gap-3">
        <Field label={t("rebalance.next.amount")}>
          <Input
            inputMode="decimal"
            placeholder={t("form.amountPlaceholder")}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        {plan ? (
          plan.rows.length === 0 ? (
            <p className="m-0 text-sm text-muted">{t("rebalance.next.noneBelow")}</p>
          ) : (
            <ul
              aria-label={t("rebalance.next.split")}
              className="m-0 list-none divide-y divide-line p-0"
            >
              {plan.rows.map((row) => (
                <li key={row.assetClass} className="flex justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">{t(`classes.${row.assetClass as AssetClass}`)}</span>
                  <span className="font-medium tabular-nums">{moneyText(row.amount)}</span>
                </li>
              ))}
            </ul>
          )
        ) : null}
        {plan && money(plan.leftover).gt(0) ? (
          <p className="m-0 text-sm text-muted">
            {t("rebalance.next.leftover", { amount: moneyText(plan.leftover) })}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

export function RebalanceBoard({ data, writable }: { data: Data; writable: boolean }) {
  const t = useTranslations("investimentos");
  const [editing, setEditing] = useState<number | null>(null);
  const close = () => setEditing(null);
  const hasTargets = data.summary.classes.some((share) => share.target !== null);
  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("rebalance.title")}
        description={t("rebalance.description")}
        actions={
          writable ? (
            <Button variant="secondary" onClick={() => setEditing((n) => (n ?? 0) + 1)}>
              <Target className="size-4" aria-hidden="true" />
              {t("rebalance.targets")}
            </Button>
          ) : null
        }
      />
      {data.rows.length === 0 ? (
        <Card>
          <EmptyState title={t("rebalance.empty.title")} text={t("rebalance.empty.text")} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <Card
            title={t("rebalance.byClass.title")}
            description={t("rebalance.byClass.description")}
          >
            <ClassBars data={data} />
          </Card>
          {hasTargets ? (
            <NextContribution data={data} />
          ) : (
            <Card>
              <EmptyState
                title={t("rebalance.noTargets.title")}
                text={t("rebalance.noTargets.text")}
              />
            </Card>
          )}
        </div>
      )}
      <p className="m-0 text-xs text-muted">{t("rebalance.disclaimer")}</p>
      <Sheet open={editing !== null} onClose={close} title={t("rebalance.form.title")}>
        <TargetsForm key={editing} data={data} onDone={close} />
      </Sheet>
    </>
  );
}
