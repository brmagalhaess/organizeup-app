// Contagens da plataforma (ops.platform_stats). O worker percorre as famílias uma a uma, cada uma na
// própria transação com RLS, e só soma: nada que identifique a família sai daqui.
import { and, gte, isNull, sql } from "drizzle-orm";
import { appPool } from "./client";
import { household, householdAccess, householdMember, session, user } from "./schema";
import { recordPlatformStats, type PlatformCounts } from "./ops";
import { listHouseholdIds } from "./wealth";
import { withWorkerHousehold, type TenantTx } from "./tenant";

export const PLATFORM_MODULES = ["entries", "investments", "goals", "trips", "retirement"] as const;
export type PlatformModule = (typeof PLATFORM_MODULES)[number];
export type ModuleUsage = Record<PlatformModule, boolean>;

/**
 * Quais módulos a família usa, só sim ou não. Recebe o id porque o painel chama com a conexão
 * administrativa, sem RLS; `retirement_plan` só tem linha depois que a família salva o plano.
 */
export async function householdModuleUsage(
  db: Pick<TenantTx, "execute">,
  householdId: string,
): Promise<ModuleUsage> {
  const rows = await db.execute<ModuleUsage>(sql`
    select
      exists(select 1 from transactions where household_id = ${householdId}) as entries,
      exists(select 1 from investments where household_id = ${householdId}) as investments,
      exists(select 1 from goals where household_id = ${householdId}) as goals,
      exists(select 1 from trips where household_id = ${householdId}) as trips,
      exists(select 1 from retirement_plan where household_id = ${householdId})
        or exists(select 1 from retirement_scenarios where household_id = ${householdId})
        as retirement`);
  return rows[0]!;
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function activeHouseholds(days: number): Promise<number> {
  const since = new Date(Date.now() - days * DAY_MS);
  const [row] = await appPool()
    .db.select({
      n: sql<number>`count(distinct ${householdMember.organizationId})::int`,
    })
    .from(householdMember)
    .innerJoin(session, sql`${session.userId} = ${householdMember.userId}`)
    .innerJoin(household, sql`${household.id} = ${householdMember.organizationId}`)
    .where(and(gte(session.updatedAt, since), isNull(householdAccess.suspendedAt)));
  return row?.n ?? 0;
}

interface Log {
  error: (data: object, message: string) => void;
}

/**
 * Soma o uso por módulo e grava a linha do dia. Rodar de novo no mesmo dia substitui. Família que
 * falha fica de fora da soma do dia e vai para o log só com id e código.
 */
export async function collectPlatformStats(day: string, log: Log): Promise<PlatformCounts> {
  const ids = await listHouseholdIds();
  const counts: PlatformCounts = {
    households: ids.length,
    users: 0,
    active7d: 0,
    active30d: 0,
    useEntries: 0,
    useInvestments: 0,
    useGoals: 0,
    useTrips: 0,
    useRetirement: 0,
  };
  for (const householdId of ids) {
    try {
      const usage = await withWorkerHousehold(householdId, (tx) =>
        householdModuleUsage(tx, householdId),
      );
      counts.useEntries += Number(usage.entries);
      counts.useInvestments += Number(usage.investments);
      counts.useGoals += Number(usage.goals);
      counts.useTrips += Number(usage.trips);
      counts.useRetirement += Number(usage.retirement);
    } catch (err) {
      const code = (err as { code?: string }).code;
      log.error({ householdId, code }, "estatística da plataforma: família falhou");
    }
  }
  const [users] = await appPool()
    .db.select({ n: sql<number>`count(*)::int` })
    .from(user);
  counts.users = users?.n ?? 0;
  counts.active7d = await activeHouseholds(7);
  counts.active30d = await activeHouseholds(30);
  await recordPlatformStats(day, counts);
  return counts;
}
