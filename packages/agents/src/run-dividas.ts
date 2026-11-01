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
import { recommendedStrategy, yearMonthOf, type DebtPlan } from "@organizeup/domain";
import { currentDebtPlan } from "./debt-view";
import type { ReportDividas } from "./reports";
import {
  clamp,
  loadDecisions,
  MAX_REPORT_SUMMARY,
  MAX_REPORT_TITLE,
  messageColumns,
  upsertPending,
  type AgentInput,
  type AgentResult,
  type PendingSuggestion,
} from "./shared";
import { DEDUPE, type AporteDividaPayload } from "./suggestions";
import { aporteDividaPlanoText, dividasReportText, dividasVaziasReportText } from "./texts";

export const DIVIDAS_AGENT = "dividas";

function suggestionsOf(plan: DebtPlan, month: string): PendingSuggestion[] {
  const best = recommendedStrategy(plan);
  return best.thisMonth.map((item) => {
    const payload: AporteDividaPayload = { debtId: item.id, extraMonthly: item.amount };
    return {
      kind: "aporte_divida",
      ...aporteDividaPlanoText({
        amount: item.amount,
        debt: item.name,
        strategy: plan.recommended,
      }),
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
  const message = messageColumns(report.message);
  await tx
    .insert(debtPlanReports)
    .values({ householdId, day, title, summary, data: report.data, ...message })
    .onConflictDoUpdate({
      target: [debtPlanReports.householdId, debtPlanReports.day],
      set: { title, summary, data: report.data, ...message, updatedAt: sql`now()` },
    });
}

export async function runDividasAgent(tx: TenantTx, input: AgentInput): Promise<AgentResult> {
  const { today, householdId } = input;
  const month = yearMonthOf(today);
  const { plan } = await currentDebtPlan(tx, today);
  const data: ReportDividas = { plan };

  if (!plan) {
    const report = { ...dividasVaziasReportText(today), data };
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

  const report = { ...dividasReportText(today, plan, previous), data };
  await saveReport(tx, householdId, today, report);
  return { suggestions, applied: 0, report };
}
