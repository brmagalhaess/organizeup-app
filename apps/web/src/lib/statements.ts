import "server-only";
import {
  householdCurrency,
  readStatement,
  statementKinds,
  statementPeriods,
} from "@organizeup/agents";
import { tolerateSchemaLag, withHousehold, type TenantContext } from "@organizeup/db";
import {
  isStatementKind,
  isStatementPeriod,
  previousPeriod,
  STATEMENT_KINDS,
  type ReportKind,
} from "@organizeup/domain";

export interface ReportRequest {
  tipo?: string | undefined;
  periodo?: string | undefined;
  comparar?: string | undefined;
}

/** Tipo que a família pediu; sem pedido, o primeiro que ela tem. */
const chosenKind = (asked: string | undefined, available: ReportKind[]): ReportKind => {
  if (asked && isStatementKind(asked)) return asked;
  return STATEMENT_KINDS.find((kind) => available.includes(kind)) ?? STATEMENT_KINDS[0];
};

/**
 * Tudo da tela de relatórios, numa transação curta. Sem a migração aplicada, a tela abre no estado
 * vazio. Comparar sem escolher usa o período anterior, se ele existir.
 */
export async function loadReports(ctx: TenantContext, request: ReportRequest) {
  return tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const available = await statementKinds(tx);
        const kind = chosenKind(request.tipo, available);
        const periods = await statementPeriods(tx, kind);
        const asked = request.periodo && isStatementPeriod(request.periodo) ? request.periodo : "";
        const period = asked || periods[0]?.period || "";
        const statement = period ? await readStatement(tx, kind, period) : null;
        const other =
          request.comparar === "nenhum"
            ? ""
            : request.comparar && isStatementPeriod(request.comparar)
              ? request.comparar
              : period
                ? previousPeriod(period)
                : "";
        const comparison = other && other !== period ? await readStatement(tx, kind, other) : null;
        return {
          hasAny: available.length > 0,
          kind,
          period,
          periods,
          statement,
          comparison,
          currency: await householdCurrency(tx, ctx.householdId),
        };
      }),
    {
      hasAny: false,
      kind: chosenKind(request.tipo, []),
      period: "",
      periods: [],
      statement: null,
      comparison: null,
      currency: "BRL" as const,
    },
  );
}

/** Um relatório para baixar. Null: esta família não tem esse relatório. */
export async function loadReportFile(ctx: TenantContext, kind: ReportKind, period: string) {
  return tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const statement = await readStatement(tx, kind, period);
        if (!statement) return null;
        return { statement, currency: await householdCurrency(tx, ctx.householdId) };
      }),
    null,
  );
}
