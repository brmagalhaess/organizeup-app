import type { Metadata } from "next";
import Link from "next/link";
import type { PlanAction } from "@organizeup/domain";
import { formatBRL } from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
import { Badge, Card, PageHeader } from "@/components/ui";
import { loadMonthlyPlan } from "@/lib/planning";
import { requireTenant } from "@/lib/session";

export const metadata: Metadata = { title: "Seu plano" };

const yearsLabel = (years: number) => (years === 1 ? "1 ano mais cedo" : `${years} anos mais cedo`);

const TEXT: Record<
  PlanAction["kind"],
  { title: (action: PlanAction) => string; text: string; href: string; link: string }
> = {
  completar: {
    title: () => "Complete o seu plano de aposentadoria",
    text: "Sem o ano em que você quer parar e a renda desejada, não dá para calcular o efeito de cada escolha.",
    href: "/app/aposentadoria",
    link: "Completar o plano",
  },
  reserva: {
    title: (action) => `Guarde ${formatBRL(action.amount!)} na reserva`,
    text: "A reserva vem primeiro: ela evita usar crédito caro quando surge um imprevisto.",
    href: "/app/reserva",
    link: "Ver a reserva",
  },
  divida: {
    title: (action) => `Pague ${formatBRL(action.amount!)} a mais na dívida mais cara`,
    text: "Os juros dessa dívida custam mais do que o dinheiro rende. Depois de quitar, o valor segue para o seu plano.",
    href: "/app/dividas",
    link: "Ver as dívidas",
  },
  guardar: {
    title: (action) => `Guarde ${formatBRL(action.amount!)} a mais por mês`,
    text: "Esse valor entra no plano de aposentadoria e passa a render proventos.",
    href: "/app/aposentadoria",
    link: "Ver o plano",
  },
  gasto: {
    title: (action) => `Reduza ${formatBRL(action.amount!)} em ${action.category}`,
    text: "É 10% da sua maior categoria no mês passado. Guardar essa diferença também encurta o caminho.",
    href: "/app/lancamentos",
    link: "Ver os lançamentos",
  },
};

export default async function PlanPage() {
  const { ctx } = await requireTenant();
  const { actions, targetYear, year } = await loadMonthlyPlan(ctx);
  const description =
    year === null
      ? "As ações que mais aproximam a sua família da aposentadoria."
      : `Com o que você guarda hoje, a carteira fecha em ${year}${
          targetYear ? `, e o seu alvo é ${targetYear}` : ""
        }.`;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Este mês" title="Seu plano" description={description} />
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {actions.map((action, index) => {
          const copy = TEXT[action.kind];
          return (
            <li key={action.kind}>
              <Card title={`${index + 1}. ${copy.title(action)}`} description={copy.text}>
                <div className="flex flex-wrap items-center gap-3">
                  {action.yearsEarlier !== null && action.yearsEarlier > 0 ? (
                    <Badge tone="success">{yearsLabel(action.yearsEarlier)}</Badge>
                  ) : null}
                  <Link href={copy.href} className={buttonClass("secondary", true)}>
                    {copy.link}
                  </Link>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
      <p className="m-0 text-sm text-muted">
        Estimativas em reais de hoje, sem garantia de rendimento. Conteúdo educativo, não é
        recomendação de investimento.
      </p>
    </div>
  );
}
