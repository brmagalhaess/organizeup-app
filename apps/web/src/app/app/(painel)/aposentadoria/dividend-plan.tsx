"use client";
import Link from "next/link";
import { useActionState } from "react";
import { formatBRL, money, type DividendPlan as Plan } from "@organizeup/domain";
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
import type { loadDividendPlan } from "@/lib/planning";
import { acceptSavingAmounts, saveRetirementPlan, type FormState } from "./actions";
import { DividendChart } from "./dividend-chart";

type Data = Awaited<ReturnType<typeof loadDividendPlan>>;

const initial: FormState = { ok: false, message: null };
const comma = (value: string | null | undefined) => value?.replace(".", ",") ?? "";

const TARGET_BASIS: Record<Plan["targetBasis"], string> = {
  informado: "informada por você",
  gasto_medio: "igual ao seu gasto médio",
  essencial_120: "seu gasto essencial mais 20%",
  sem_dados: "",
};

function yieldHint(plan: Plan): string {
  switch (plan.yieldBasis) {
    case "observado_12m":
      return "pelos proventos dos últimos 12 meses";
    case "observado_anualizado":
      return `baseado em ${plan.yieldMonthsBasis} meses`;
    case "suspeito":
      return `os proventos indicam ${comma(plan.observedYield)}%, fora do esperado; usamos o informado`;
    default:
      return "informado";
  }
}

function SavingHighlight({ data, writable }: { data: Data; writable: boolean }) {
  const { suggested, surplus, contribution } = data;
  const [state, action, pending] = useActionState(acceptSavingAmounts, initial);
  const none = money(suggested.total).isZero();
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-card-soft p-5 sm:p-6">
      <div>
        <p className="text-lg font-semibold sm:text-2xl">
          Guarde por mês: <span className="tabular-nums">{formatBRL(suggested.total)}</span>
        </p>
        <p className="mt-1 text-sm tabular-nums">
          ({formatBRL(suggested.reserve)} na reserva + {formatBRL(suggested.investment)} em
          investimentos)
        </p>
      </div>
      {money(suggested.debt).gt(0) ? (
        <p className="text-sm">
          Antes disso, {formatBRL(suggested.debt)} por mês vão para quitar dívidas caras.
        </p>
      ) : null}
      <p className="text-xs text-muted">
        {surplus.basis === "previsto"
          ? "Calculado pela sua renda e pelas despesas previstas."
          : `Calculado pelo que sobrou nos últimos ${surplus.months} meses.`}
      </p>
      {none ? (
        <p className="text-sm">
          Hoje não sobra dinheiro para guardar. Registre sua renda e seus gastos, ou reveja as
          despesas.
        </p>
      ) : suggested.accepted ? (
        <p className="text-sm font-medium">Este é o valor do seu plano.</p>
      ) : (
        <>
          {data.form.monthlyContribution !== null ? (
            <p className="text-sm">Hoje o plano usa {formatBRL(contribution)} em investimentos.</p>
          ) : null}
          {writable ? (
            <form onSubmit={submitKeeping(action)} className="flex flex-col gap-2 sm:items-start">
              <input type="hidden" name="reserve" value={suggested.reserve} />
              <input type="hidden" name="investment" value={suggested.investment} />
              <Button type="submit" disabled={pending}>
                {pending ? "Salvando…" : "Aceitar este valor"}
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
  const { plan, contribution } = data;
  const closes = plan.yearWithContribution;
  const others = money(plan.otherBase).gt(0);
  return (
    <>
      <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile
          label="Renda que você quer por mês"
          value={formatBRL(plan.targetIncome ?? "0")}
          hint={
            money(plan.otherIncome).gt(0)
              ? `${TARGET_BASIS[plan.targetBasis]}; ${formatBRL(plan.otherIncome)} vêm do INSS ou pensão`
              : TARGET_BASIS[plan.targetBasis]
          }
        />
        <StatTile
          label="Renda atual em proventos"
          value={formatBRL(plan.currentIncome)}
          hint={`já cobre ${plan.coverage}%`}
        />
        <StatTile
          label="Rendimento anual da carteira"
          value={`${comma(plan.yieldUsed)}%`}
          hint={yieldHint(plan)}
        />
        <StatTile
          label="Quanto precisa ter investido"
          value={formatBRL(plan.requiredPortfolio ?? "0")}
          hint={
            money(plan.portfolioGap ?? "0").gt(0)
              ? `faltam ${formatBRL(plan.portfolioGap ?? "0")}`
              : "você já tem esse valor"
          }
        />
        <StatTile
          label="Carteira que paga renda"
          value={formatBRL(plan.incomeBase)}
          hint="investimentos com proventos nos últimos 12 meses"
        />
        <StatTile
          label="Outros investimentos"
          value={formatBRL(plan.otherBase)}
          hint="ainda não pagam proventos"
        />
      </dl>
      {others ? (
        <p className="text-xs text-muted">
          Nota: contamos os outros investimentos no que você já tem, supondo que um dia eles passem
          para ativos que pagam renda.
        </p>
      ) : null}

      <Card title="Até quando">
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
          <li>
            {closes === null
              ? `Guardando ${formatBRL(contribution)} por mês, a carteira não fecha em 60 anos.`
              : `Guardando ${formatBRL(contribution)} por mês, a carteira fecha em ${closes}.`}
          </li>
          {plan.requiredContribution !== null && money(plan.requiredContribution).gt(0) ? (
            <li>
              Para fechar em {targetYear} seria preciso {formatBRL(plan.requiredContribution)} por
              mês.
            </li>
          ) : null}
          {plan.projectedIncomeAtTarget !== null ? (
            <li>
              Em {targetYear} a carteira pagaria {formatBRL(plan.projectedIncomeAtTarget)} por mês.
            </li>
          ) : null}
          {plan.pensionsLater.map((pension) => (
            <li key={`${pension.fromYear}-${pension.amount}`}>
              {formatBRL(pension.amount)} de INSS entra só em {pension.fromYear}.
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
  const { plan, targetYear } = data;
  const noIncome = plan.status === "sem_dados";
  return (
    <div className="flex flex-col gap-3">
      {targetYear === null || noIncome ? (
        <EmptyState
          title="Complete seu plano de aposentadoria"
          text={
            targetYear === null
              ? "Diga em que ano querem parar de trabalhar. Com isso calculamos quanto guardar por mês."
              : "Informe a renda que você quer por mês ou registre seus gastos."
          }
          action={
            <Link href="/app/completar" className={buttonClass("secondary", true)}>
              Completar cadastro
            </Link>
          }
        />
      ) : null}
      {plan.status === "sem_yield" ? (
        <EmptyState
          title="Informe o rendimento anual da carteira ou registre proventos"
          text="Sem isso não dá para calcular quanto precisa ter investido."
          action={
            <Link href="/app/proventos" className={buttonClass("secondary", true)}>
              Registrar proventos
            </Link>
          }
        />
      ) : null}
    </div>
  );
}

function PlanForm({ data }: { data: Data }) {
  const [state, action, pending] = useActionState(saveRetirementPlan, initial);
  const { form } = data;
  return (
    <Card title="Seu plano" description="O que ficar vazio o assistente calcula para você.">
      <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Renda que você quer por mês (R$)" hint="Vazio: usamos seu gasto médio.">
            <Input
              name="targetIncome"
              inputMode="decimal"
              placeholder="8.000,00"
              defaultValue={comma(form.targetIncome)}
            />
          </Field>
          <Field
            label="Rendimento anual da carteira (%)"
            hint="Quanto a carteira paga em proventos por ano. Ex.: R$ 100 mil que pagam R$ 6 mil = 6%."
          >
            <Input
              name="expectedYield"
              inputMode="decimal"
              placeholder="6,00"
              defaultValue={comma(form.expectedYield)}
            />
          </Field>
          <Field label="Quanto guardar por mês (R$)" hint="Vazio: usamos o valor sugerido.">
            <Input
              key={form.monthlyContribution ?? ""}
              name="monthlyContribution"
              inputMode="decimal"
              placeholder="1.000,00"
              defaultValue={comma(form.monthlyContribution)}
            />
          </Field>
        </div>
        <details className="text-sm">
          <summary className="w-fit cursor-pointer rounded-lg font-medium">
            Ajustes avançados
          </summary>
          <div className="mt-3 max-w-sm">
            <Field
              label="Crescimento dos proventos (%)"
              hint="Ao ano, acima da inflação. Na dúvida, deixe 0."
            >
              <Input
                name="dividendGrowth"
                inputMode="decimal"
                defaultValue={comma(form.dividendGrowth)}
              />
            </Field>
          </div>
        </details>
        <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando…" : "Salvar plano"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function DividendPlan({ data, writable }: { data: Data; writable: boolean }) {
  const { plan, targetYear } = data;
  return (
    <section aria-labelledby="viver-dos-rendimentos" className="flex flex-col gap-4">
      <div>
        <h2 id="viver-dos-rendimentos" className="font-display text-2xl font-medium">
          Viver dos rendimentos
        </h2>
        <p className="mt-1 text-sm text-muted">
          A carteira paga as contas e não acaba. Este é o plano que o assistente acompanha.
        </p>
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

      <p className="text-xs text-muted">
        Estimativa. Proventos passados não garantem proventos futuros; nada aqui é recomendação de
        investimento.
      </p>
    </section>
  );
}
