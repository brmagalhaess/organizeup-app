"use client";
import { AlertCircle, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  money,
  parseMoney,
  simulatePayoff,
  toDbAmount,
  type PayoffDebt,
  type PayoffResult,
} from "@organizeup/domain";
import { Badge, Card, Field, Input } from "@/components/ui";
import { toAmountInput } from "@/i18n/format";
import { useMoney } from "@/i18n/money";

function useDuration() {
  const t = useTranslations("dividas.payoff");
  return (total: number) => {
    const count = Math.floor(total / 12);
    const rest = total % 12;
    const years = t("years", { count });
    const months = t("months", { count: rest });
    if (count > 0 && rest > 0) return t("yearsAndMonths", { years, months });
    if (count > 0) return years;
    return rest > 0 ? months : t("thisMonth");
  };
}

function Result({
  title,
  text,
  result,
  baseline,
  best,
}: {
  title: string;
  text: string;
  result: PayoffResult;
  baseline: PayoffResult;
  best: boolean;
}) {
  const t = useTranslations("dividas.payoff");
  const moneyText = useMoney();
  const duration = useDuration();
  const saved = toDbAmount(money(baseline.totalInterest).minus(result.totalInterest));
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-xl border border-line bg-card-soft p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        {best ? (
          <Badge tone="success">
            <Sparkles className="size-3" aria-hidden="true" />
            {t("lessInterest")}
          </Badge>
        ) : null}
      </div>
      <p className="text-sm text-muted">{text}</p>
      {result.focus ? (
        <p className="text-sm">
          {t.rich("startWith", {
            name: result.focus.name,
            strong: (chunks) => <span className="font-semibold">{chunks}</span>,
          })}
        </p>
      ) : null}
      {result.stalled ? (
        <p className="flex items-start gap-2 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("stalled")}
        </p>
      ) : (
        <dl className="m-0 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted">{t("paidOffIn")}</dt>
            <dd className="m-0 font-semibold">{duration(result.months)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t("interestToEnd")}</dt>
            <dd className="m-0 font-semibold tabular-nums">{moneyText(result.totalInterest)}</dd>
          </div>
          {!money(saved).isZero() ? (
            <div className="col-span-2">
              <dt className="text-xs text-muted">{t("savings")}</dt>
              <dd className="m-0 font-semibold tabular-nums">{moneyText(saved)}</dd>
            </div>
          ) : null}
        </dl>
      )}
      <p className="text-xs text-muted">{t("whenEach")}</p>
      <ol className="m-0 list-none space-y-1 p-0 text-sm">
        {result.order.map((item) => (
          <li key={item.id} className="flex justify-between gap-3">
            <span className="truncate">{item.name}</span>
            <span className="whitespace-nowrap text-xs text-muted">{duration(item.month)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Compara as duas ordens de quitação. É uma estimativa, não muda nenhuma parcela. */
export function PayoffPlanner({ debts }: { debts: PayoffDebt[] }) {
  const t = useTranslations("dividas.payoff");
  const locale = useLocale();
  const [extra, setExtra] = useState("");

  const value = useMemo(() => {
    try {
      const parsed = extra.trim() ? parseMoney(extra, locale) : money(0);
      return parsed.lt(0) ? null : toDbAmount(parsed);
    } catch {
      return null;
    }
  }, [extra, locale]);

  const results = useMemo(
    () =>
      value === null
        ? null
        : {
            baseline: simulatePayoff(debts, "0", "minimum"),
            avalanche: simulatePayoff(debts, value, "avalanche"),
            snowball: simulatePayoff(debts, value, "snowball"),
          },
    [debts, value],
  );

  return (
    <Card title={t("title")} description={t("description")}>
      <div className="max-w-xs">
        <Field
          label={t("extra")}
          hint={t("extraHint")}
          error={value === null ? t("extraError") : undefined}
        >
          <Input
            inputMode="decimal"
            placeholder={toAmountInput("0.00", locale)}
            value={extra}
            onChange={(event) => setExtra(event.target.value)}
          />
        </Field>
      </div>
      {results ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Result
            title={t("avalanche")}
            text={t("avalancheText")}
            result={results.avalanche}
            baseline={results.baseline}
            best={money(results.avalanche.totalInterest).lt(results.snowball.totalInterest)}
          />
          <Result
            title={t("snowball")}
            text={t("snowballText")}
            result={results.snowball}
            baseline={results.baseline}
            best={money(results.snowball.totalInterest).lt(results.avalanche.totalInterest)}
          />
        </div>
      ) : null}
    </Card>
  );
}
