// A rodada diária de verdade contra um Postgres com as migrações, pela conexão do worker: nada de
// `recordAgentRun` simulado. O CHECK de `ops.agent_runs` só aparece aqui, e nome recusado por ele some
// em silêncio (o erro só vai para o log). Dados fictícios.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.worker;
process.env.ADMIN_DATABASE_URL = urls.admin;
delete process.env.ANTHROPIC_API_KEY;

const db = await import("@organizeup/db");
const { MERCADO_AGENT } = await import("@organizeup/agents");
const { todayIn, TRIP_INTENTIONS_RUN } = await import("@organizeup/domain");
const { INSIGHTS_AGENT } = await import("./insights");
const { agentsToRun, DAILY_AGENTS, runDailyAgents } = await import("./daily-agents");

const { household, householdMember, householdSettings, people, session, tripIntentions, user } = db;

const stamp = randomUUID().slice(0, 8);
const family = `hh-rodada-${stamp}`;
const owner = `user-rodada-${stamp}`;
const errors: unknown[][] = [];
const log = {
  error: (...args: unknown[]) => void errors.push(args),
  info: () => undefined,
};
const day = todayIn();

beforeAll(async () => {
  await db.withAdmin("seed da rodada do worker", async (admin) => {
    await admin.insert(user).values({ id: owner, name: "Ana", email: `ana.${stamp}@example.com` });
    await admin.insert(household).values({ id: family, name: "Família", slug: family });
    await admin
      .insert(householdMember)
      .values({ id: `m-${stamp}`, organizationId: family, userId: owner, role: "owner" });
    const now = new Date();
    await admin.insert(session).values({
      id: `s-${stamp}`,
      userId: owner,
      token: `token-${stamp}`,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });
  });
  await db.withWorkerHousehold(family, async (tx) => {
    await tx
      .insert(householdSettings)
      .values({ householdId: family, tripsPerYear: 1, tripDays: 5, retirementYear: 2040 });
    await tx
      .insert(people)
      .values({ householdId: family, name: "Titular", relation: "titular", userId: owner });
    await db.ensureFinanceDefaults(tx, family);
    await tx.insert(tripIntentions).values({ householdId: family, destinationId: "lisboa" });
  });
  await runDailyAgents(log);
});

afterAll(async () => {
  await db.closeAllPools();
});

describe("registro da rodada em ops.agent_runs", () => {
  it("nenhum nome é recusado pelo banco", () => {
    expect(errors).toEqual([]);
  });

  it("todo agente da rodada e a linha das intenções ficam registrados", async () => {
    const rows = await db.listAgentRuns(1);
    const names = rows.map((row) => row.agent);
    for (const agent of DAILY_AGENTS) expect(names).toContain(agent);
    expect(names).toContain(TRIP_INTENTIONS_RUN);
    const line = rows.find((row) => row.agent === TRIP_INTENTIONS_RUN);
    expect(line).toMatchObject({ households: 1, ok: 1, failed: 0 });
  });

  it("os agentes de fila própria também cabem no CHECK", async () => {
    for (const agent of [MERCADO_AGENT, INSIGHTS_AGENT]) {
      const counts = { households: 0, ok: 0, failed: 0, suggestions: 0, applied: 0 };
      await db.recordAgentRun("2026-01-01", agent, counts);
      expect(await db.hasAgentRunToday("2026-01-01", agent)).toBe(true);
    }
  });

  it("a rede de segurança das 05:30 vê que todos rodaram e não repete nenhum", async () => {
    expect(await agentsToRun({ missingOnly: true }, [], day)).toEqual([]);
  });
});
