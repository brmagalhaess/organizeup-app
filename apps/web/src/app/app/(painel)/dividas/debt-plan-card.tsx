import { AlertCircle, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  money,
  recommendedStrategy,
  type DebtPlan,
  type DebtPlanStrategy,
  type DebtSignal,
} from "@organizeup/domain";
import { Badge, Card, FormMessage } from "@/components/ui";
import { formatAmount, formatMonthYear, toAmountInput } from "@/i18n/format";

function useWhenText() {
  const t = useTranslations("dividas.plan");
  const locale = useLocale();
  return (month: string | null) => (month ? formatMonthYear(month, locale) : t("noFinish"));
}

/** O domínio entrega a frase em português: daqui só saem o tipo do sinal e os números dela. */
function useSignalText() {
  const t = useTranslations("dividas.plan.signals");
  const locale = useLocale();
  return ({ kind, text }: DebtSignal) => {
    const numbers = text.match(/\d+(?:,\d+)?/g) ?? [];
    const rate = toAmountInput((numbers[0] ?? "").replace(",", "."), locale);
    if (kind === "dado_faltando") return t(kind);
    if (kind === "vence_antes_da_renda" && numbers.length === 2)
      return t(kind, { due: numbers[0] ?? "", income: numbers[1] ?? "" });
    if (kind !== "vence_antes_da_renda" && rate) return t(kind, { rate });
    return text;
  };
}

function StrategyRow({ item, plan }: { item: DebtPlanStrategy; plan: DebtPlan }) {
  const t = useTranslations("dividas.plan");
  const locale = useLocale();
  const whenText = useWhenText();
  return (
    <tr className="border-b border-line last:border-0">
      <th scope="row" className="py-2 pr-2 text-left font-medium">
        {t(`strategies.${item.strategy}`)}{" "}
        {plan.recommended === item.strategy ? <Badge tone="success">{t("cheapest")}</Badge> : null}
      </th>
      <td className="px-2 py-2">{whenText(item.payoffMonth)}</td>
      <td className="px-2 py-2 text-right tabular-nums">
        {formatAmount(item.totalInterest, locale)}
      </td>
      <td className="py-2 pl-2 text-right tabular-nums">{formatAmount(item.saved, locale)}</td>
    </tr>
  );
}

function Comparison({ plan }: { plan: DebtPlan }) {
  const t = useTranslations("dividas.plan");
  const locale = useLocale();
  const whenText = useWhenText();
  return (
    <details className="mt-4 rounded-xl border border-line bg-card-soft p-4 text-sm">
      <summary className="cursor-pointer font-semibold">{t("compare")}</summary>
      <div
        role="region"
        aria-label={t("compareScroll")}
        tabIndex={0}
        className="mt-3 overflow-x-auto"
      >
        <table className="w-full min-w-[30rem] border-collapse">
          <caption className="sr-only">{t("compareCaption")}</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-2 font-medium">
                {t("strategy")}
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                {t("paidOffBy")}
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                {t("interestToEnd")}
              </th>
              <th scope="col" className="py-2 pl-2 text-right font-medium">
                {t("savings")}
              </th>
            </tr>
          </thead>
          <tbody>
            <StrategyRow item={plan.avalanche} plan={plan} />
            <StrategyRow item={plan.snowball} plan={plan} />
            <tr>
              <th scope="row" className="py-2 pr-2 text-left font-medium">
                {t("onlyInstallments")}
              </th>
              <td className="px-2 py-2">{whenText(plan.baseline.payoffMonth)}</td>
              <td className="px-2 py-2 text-right tabular-nums">
                {formatAmount(plan.baseline.totalInterest, locale)}
              </td>
              <td className="py-2 pl-2 text-right tabular-nums">{formatAmount(0, locale)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** O plano no topo da tela: quando acaba, quanto economiza e o que fazer neste mês. */
export function DebtPlanCard({ plan }: { plan: DebtPlan }) {
  const t = useTranslations("dividas.plan");
  const locale = useLocale();
  const signalText = useSignalText();
  const best = recommendedStrategy(plan);
  const hasExtra = best.thisMonth.length > 0;
  const when = best.payoffMonth ? formatMonthYear(best.payoffMonth, locale) : null;
  const headline = !when
    ? t("noEnd")
    : money(best.saved).isZero()
      ? t("payOff", { when })
      : t("payOffSaving", { when, saved: formatAmount(best.saved, locale) });
  return (
    <Card title={headline} description={t("description")}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section aria-label={t("thisMonthLabel")}>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="size-4 text-brand-500" aria-hidden="true" />
            {t("thisMonth")}
          </h3>
          {hasExtra ? (
            <ul className="m-0 mt-2 list-none space-y-1 p-0 text-sm">
              {best.thisMonth.map((item) => (
                <li key={item.id}>
                  {t.rich("payExtra", {
                    amount: formatAmount(item.amount, locale),
                    name: item.name,
                    strong: (chunks) => <span className="font-semibold">{chunks}</span>,
                  })}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">{t("noExtra")}</p>
          )}
        </section>
        <section aria-label={t("attackOrder")}>
          <h3 className="text-sm font-semibold">{t("attackOrder")}</h3>
          <ol className="m-0 mt-2 list-inside list-decimal space-y-1 p-0 text-sm">
            {best.attack.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ol>
        </section>
      </div>
      {plan.signals.length > 0 ? (
        <ul aria-label={t("attention")} className="m-0 mt-4 list-none space-y-2 p-0 text-sm">
          {plan.signals.map((signal) => (
            <li key={`${signal.kind}:${signal.debtId}`} className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <span>
                <span className="font-semibold">{signal.debtName}:</span> {signalText(signal)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {money(plan.extra).isZero() ? null : (
        <p className="mt-3 text-xs text-muted">
          {t("extraUsed", { value: formatAmount(plan.extra, locale) })}
        </p>
      )}
      <Comparison plan={plan} />
    </Card>
  );
}

export function DebtPlanError() {
  const t = useTranslations("dividas.plan");
  return (
    <Card title={t("errorTitle")}>
      <FormMessage message={t("errorText")} />
    </Card>
  );
}
