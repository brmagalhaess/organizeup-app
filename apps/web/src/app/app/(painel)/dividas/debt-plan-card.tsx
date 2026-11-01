import { AlertCircle, Sparkles } from "lucide-react";
import {
  debtPlanHeadline,
  formatBRL,
  formatYearMonth,
  money,
  recommendedStrategy,
  type DebtPlan,
  type DebtPlanStrategy,
} from "@organizeup/domain";
import { Badge, Card, FormMessage } from "@/components/ui";

const STRATEGY_LABEL = {
  avalanche: "Maior juro primeiro",
  snowball: "Menor saldo primeiro",
} as const;

const whenText = (month: string | null) =>
  month ? formatYearMonth(month) : "Não termina com essas parcelas";

function StrategyRow({ item, plan }: { item: DebtPlanStrategy; plan: DebtPlan }) {
  return (
    <tr className="border-b border-line last:border-0">
      <th scope="row" className="py-2 pr-2 text-left font-medium">
        {STRATEGY_LABEL[item.strategy]}{" "}
        {plan.recommended === item.strategy ? <Badge tone="success">Mais barata</Badge> : null}
      </th>
      <td className="px-2 py-2">{whenText(item.payoffMonth)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{formatBRL(item.totalInterest)}</td>
      <td className="py-2 pl-2 text-right tabular-nums">{formatBRL(item.saved)}</td>
    </tr>
  );
}

function Comparison({ plan }: { plan: DebtPlan }) {
  return (
    <details className="mt-4 rounded-xl border border-line bg-card-soft p-4 text-sm">
      <summary className="cursor-pointer font-semibold">Ver as duas estratégias</summary>
      <div
        role="region"
        aria-label="Comparação com rolagem lateral"
        tabIndex={0}
        className="mt-3 overflow-x-auto"
      >
        <table className="w-full min-w-[30rem] border-collapse">
          <caption className="sr-only">Comparação entre as estratégias de quitação</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-2 font-medium">
                Estratégia
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Tudo quitado em
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Juros até o fim
              </th>
              <th scope="col" className="py-2 pl-2 text-right font-medium">
                Economia
              </th>
            </tr>
          </thead>
          <tbody>
            <StrategyRow item={plan.avalanche} plan={plan} />
            <StrategyRow item={plan.snowball} plan={plan} />
            <tr>
              <th scope="row" className="py-2 pr-2 text-left font-medium">
                Só pagar as parcelas
              </th>
              <td className="px-2 py-2">{whenText(plan.baseline.payoffMonth)}</td>
              <td className="px-2 py-2 text-right tabular-nums">
                {formatBRL(plan.baseline.totalInterest)}
              </td>
              <td className="py-2 pl-2 text-right tabular-nums">{formatBRL(0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** O plano no topo da tela: quando acaba, quanto economiza e o que fazer neste mês. */
export function DebtPlanCard({ plan }: { plan: DebtPlan }) {
  const best = recommendedStrategy(plan);
  const hasExtra = best.thisMonth.length > 0;
  return (
    <Card
      title={debtPlanHeadline(plan)}
      description="Estimativa com as parcelas de hoje e o que sobra no mês. Nada muda sozinho."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section aria-label="O que fazer neste mês">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="size-4 text-brand-500" aria-hidden="true" />
            Neste mês
          </h3>
          {hasExtra ? (
            <ul className="m-0 mt-2 list-none space-y-1 p-0 text-sm">
              {best.thisMonth.map((item) => (
                <li key={item.id}>
                  Pague <span className="font-semibold">{formatBRL(item.amount)}</span> a mais em{" "}
                  <span className="font-semibold">{item.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">
              Hoje não sobra valor extra para as dívidas. Quando sobrar, ele aparece aqui.
            </p>
          )}
        </section>
        <section aria-label="Ordem de ataque">
          <h3 className="text-sm font-semibold">Ordem de ataque</h3>
          <ol className="m-0 mt-2 list-inside list-decimal space-y-1 p-0 text-sm">
            {best.attack.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ol>
        </section>
      </div>
      {plan.signals.length > 0 ? (
        <ul aria-label="Pontos de atenção" className="m-0 mt-4 list-none space-y-2 p-0 text-sm">
          {plan.signals.map((signal) => (
            <li key={`${signal.kind}:${signal.debtId}`} className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <span>
                <span className="font-semibold">{signal.debtName}:</span> {signal.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {money(plan.extra).isZero() ? null : (
        <p className="mt-3 text-xs text-muted">
          Valor extra usado: {formatBRL(plan.extra)} por mês, da divisão do que sobra.
        </p>
      )}
      <Comparison plan={plan} />
    </Card>
  );
}

export function DebtPlanError() {
  return (
    <Card title="Plano para sair das dívidas">
      <FormMessage message="Não conseguimos calcular o plano agora. Suas dívidas estão a salvo; tente de novo em alguns minutos." />
    </Card>
  );
}
