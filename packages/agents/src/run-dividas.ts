// Agente diário de dívidas (ADR-0019). Roda antes da aposentadoria: grava o plano de saída do dia e as
// sugestões `aporte_divida` da estratégia mais barata, que a aposentadoria deixa de gerar. Nunca muda
// dívida informada, e número lido de arquivo só conta depois de a família confirmar.
import {
  and,
  debtPlanReports,
  desc,
  eq,
  householdSuggestions,
  like,
  lt,
  sql,
  type TenantTx,
} from "@organizeup/db";
import {
  debtPlanHeadline,
  formatBRL,
  formatYearMonth,
  money,
  recommendedStrategy,
  yearMonthOf,
  type DebtPlan,
} from "@organizeup/domain";
import { currentDebtPlan } from "./debt-view";
import type { ReportDividas } from "./reports";
import {
  clamp,
  loadDecisions,
  MAX_REPORT_SUMMARY,
  MAX_REPORT_TITLE,
  plural,
  upsertPending,
  type AgentInput,
  type AgentResult,
  type PendingSuggestion,
} from "./shared";
import { DEDUPE, type AporteDividaPayload } from "./suggestions";

export const DIVIDAS_AGENT = "dividas";

const STRATEGY_NAME = { avalanche: "maior juro primeiro", snowball: "menor saldo primeiro" };

function suggestionsOf(plan: DebtPlan, month: string): PendingSuggestion[] {
  const best = recommendedStrategy(plan);
  return best.thisMonth.map((item) => {
    const payload: AporteDividaPayload = { debtId: item.id, extraMonthly: item.amount };
    return {
      kind: "aporte_divida",
      title: `Pagar ${formatBRL(item.amount)} a mais por mês em ‘${item.name}’`,
      body:
        `Pelo plano de saída (${STRATEGY_NAME[plan.recommended]}), esta é a dívida a atacar agora. ` +
        `Aceitar registra a decisão; o pagamento extra você faz na tela de dívidas.`,
      payload,
      dedupeKey: DEDUPE.aporteDivida(item.id, month),
    };
  });
}

/** O que a família aceitou neste mês não volta para a fila no dia seguinte. */
async function acceptedThisMonth(tx: TenantTx, month: string): Promise<Set<string>> {
  const rows = await tx
    .select({ key: householdSuggestions.dedupeKey })
    .from(householdSuggestions)
    .where(
      and(
        eq(householdSuggestions.status, "aplicada"),
        like(householdSuggestions.dedupeKey, DEDUPE.aporteDivida("%", month)),
      ),
    );
  return new Set(rows.map((row) => row.key));
}

async function saveReport(
  tx: TenantTx,
  householdId: string,
  day: string,
  report: AgentResult["report"],
): Promise<void> {
  const title = clamp(report.title, MAX_REPORT_TITLE);
  const summary = clamp(report.summary, MAX_REPORT_SUMMARY);
  await tx
    .insert(debtPlanReports)
    .values({ householdId, day, title, summary, data: report.data })
    .onConflictDoUpdate({
      target: [debtPlanReports.householdId, debtPlanReports.day],
      set: { title, summary, data: report.data, updatedAt: sql`now()` },
    });
}

function summaryOf(plan: DebtPlan, previous: DebtPlan | null): string {
  const best = recommendedStrategy(plan);
  const parts = [
    `${debtPlanHeadline(plan)}.`,
    `${plural(best.attack.length, "dívida", "dívidas")}, ${formatBRL(plan.totalBalance)} no total.`,
  ];
  if (best.focus) parts.push(`Comece por ‘${best.focus.name}’.`);
  if (money(plan.extra).isZero()) parts.push("Hoje não sobra valor extra para as dívidas.");
  const before = previous ? recommendedStrategy(previous).payoffMonth : null;
  if (before && best.payoffMonth && before !== best.payoffMonth) {
    parts.push(
      `A quitação mudou de ${formatYearMonth(before)} para ${formatYearMonth(best.payoffMonth)}.`,
    );
  }
  if (plan.signals.length > 0) {
    parts.push(`${plural(plan.signals.length, "ponto de atenção", "pontos de atenção")}.`);
  }
  return parts.join(" ");
}

export async function runDividasAgent(tx: TenantTx, input: AgentInput): Promise<AgentResult> {
  const { today, householdId } = input;
  const month = yearMonthOf(today);
  const { plan } = await currentDebtPlan(tx, today);
  const data: ReportDividas = { plan };

  if (!plan) {
    const report = { title: `Dívidas em ${today}`, summary: "Nenhuma dívida em aberto.", data };
    await saveReport(tx, householdId, today, report);
    return { suggestions: 0, applied: 0, report };
  }

  const [earlier] = await tx
    .select({ data: debtPlanReports.data })
    .from(debtPlanReports)
    .where(lt(debtPlanReports.day, today))
    .orderBy(desc(debtPlanReports.day))
    .limit(1);
  const previous = (earlier?.data as ReportDividas | undefined)?.plan ?? null;

  const decisions = await loadDecisions(tx, today);
  const accepted = await acceptedThisMonth(tx, month);
  const pending = suggestionsOf(plan, month).filter((item) => !accepted.has(item.dedupeKey));
  const suggestions = await upsertPending(tx, householdId, DIVIDAS_AGENT, decisions, pending);

  const report = {
    title: `Plano das dívidas em ${today}`,
    summary: summaryOf(plan, previous),
    data,
  };
  await saveReport(tx, householdId, today, report);
  return { suggestions, applied: 0, report };
}
