// Dicas da rotina da madrugada, lidas por tela. Sem a tabela ainda (a web subiu antes do worker), não
// mostra nada.
import "server-only";
import {
  and,
  asc,
  eq,
  gte,
  householdInsights,
  householdTimezone,
  tolerateSchemaLag,
  withHousehold,
  type InsightScreen,
  type TenantContext,
} from "@organizeup/db";
import { todayIn } from "@organizeup/domain";

export const SCREEN_PATHS: Record<InsightScreen, string> = {
  painel: "/app",
  lancamentos: "/app/lancamentos",
  calendario: "/app/calendario",
  metas: "/app/metas",
  viagens: "/app/viagens",
  investimentos: "/app/investimentos",
  proventos: "/app/proventos",
  aposentadoria: "/app/aposentadoria",
  reserva: "/app/reserva",
  dividas: "/app/dividas",
};

export interface InsightItem {
  id: string;
  title: string;
  body: string;
  why: string;
  href: string;
}

const MAX_ON_SCREEN = 2;
const MAX_ON_PANEL = 3;

/** No painel, as mais urgentes de todas as telas; nas outras, as da própria tela. */
export function loadInsights(ctx: TenantContext, screen: InsightScreen): Promise<InsightItem[]> {
  const panel = screen === "painel";
  return tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const today = todayIn(await householdTimezone(tx, ctx.householdId));
        const rows = await tx
          .select()
          .from(householdInsights)
          .where(
            and(
              eq(householdInsights.status, "ativa"),
              gte(householdInsights.expiresOn, today),
              panel ? undefined : eq(householdInsights.screen, screen),
            ),
          )
          .orderBy(asc(householdInsights.priority), asc(householdInsights.createdAt))
          .limit(panel ? MAX_ON_PANEL : MAX_ON_SCREEN);
        return rows.map((row) => ({
          id: row.id,
          title: row.title,
          body: row.body,
          why: row.why,
          href: SCREEN_PATHS[row.destination],
        }));
      }),
    [],
  );
}
