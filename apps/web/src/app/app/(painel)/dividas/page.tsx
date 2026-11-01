import type { Metadata } from "next";
import { canWrite } from "@organizeup/db";
import { formatBRL, formatMonthShort, todayIn, yearMonthOf } from "@organizeup/domain";
import { PageHeader, StatTile } from "@/components/ui";
import { Insights } from "@/components/insights/insights";
import { loadDebtFiles, loadDebtPlan, loadDebts } from "@/lib/commitments";
import { requireTenant } from "@/lib/session";
import { DebtPlanCard, DebtPlanError } from "./debt-plan-card";
import { DebtsBoard } from "./debts-board";
import { PayoffPlanner } from "./payoff-planner";

export const metadata: Metadata = { title: "Dívidas" };

export default async function DebtsPage() {
  const { ctx } = await requireTenant();
  const [data, plan, files] = await Promise.all([
    loadDebts(ctx),
    loadDebtPlan(ctx),
    loadDebtFiles(ctx),
  ]);
  const open = data.debts.filter((debt) => !debt.archived && debt.next);
  const lastDue = data.summary.lastDue;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Dívidas"
        title="Dívidas e empréstimos"
        description="Saiba quanto falta, quando termina e o que pagar primeiro."
      />
      <Insights screen="dividas" />
      {plan === null ? <DebtPlanError /> : null}
      {plan?.plan ? <DebtPlanCard plan={plan.plan} /> : null}
      {open.length > 0 ? (
        <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatTile label="Falta pagar" value={formatBRL(data.summary.balance)} />
          <StatTile label="Parcelas deste mês" value={formatBRL(data.summary.thisMonth)} />
          <StatTile
            label="Juros ainda a pagar"
            value={formatBRL(data.summary.interestLeft)}
            {...(open.some((debt) => debt.system === "manual")
              ? { hint: "Parcela informada não separa os juros." }
              : {})}
          />
          <StatTile
            label="Última parcela"
            value={
              lastDue
                ? `${formatMonthShort(yearMonthOf(lastDue))} de ${lastDue.slice(0, 4)}`
                : "Sem parcelas"
            }
          />
        </dl>
      ) : null}
      <DebtsBoard
        data={data}
        writable={canWrite(ctx)}
        files={files.map((file) => ({
          id: file.id,
          debtId: file.debtId,
          fileName: file.fileName,
          mediaType: file.mediaType,
          sizeBytes: file.sizeBytes,
          status: file.status,
          createdAt: todayIn(undefined, file.createdAt),
        }))}
      />
      {open.length > 1 ? (
        <PayoffPlanner
          debts={open.map((debt) => ({
            id: debt.id,
            name: debt.name,
            balance: debt.balance,
            monthlyRate: debt.system === "manual" ? "0" : debt.monthlyRate,
            rankRate: debt.monthlyRate,
            minimum: debt.next!.amount,
          }))}
        />
      ) : null}
    </div>
  );
}
