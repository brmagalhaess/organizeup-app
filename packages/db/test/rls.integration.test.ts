// Teste de isolamento entre households (obrigatório no CI — ver ADR-0002).
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import postgres from "postgres";
import { eq } from "drizzle-orm";

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;

const db = await import("../src/index");
const { closeAllPools } = await import("../src/client");
const { people, householdSettings, auditLog, household, user, householdMember } = db;

const A = {
  household: "hh-a",
  owner: "user-a-owner",
  viewer: "user-a-viewer",
  adult: "user-a-adult",
};
const B = { household: "hh-b", owner: "user-b-owner" };
let personA = "";
let personB = "";

function session(userId: string, householdId: string) {
  return { user: { id: userId }, session: { activeOrganizationId: householdId } };
}

async function ctxFor(userId: string, householdId: string) {
  const ctx = await db.fromSession(session(userId, householdId));
  if (!ctx) throw new Error(`sem contexto para ${userId}`);
  return ctx;
}

beforeAll(async () => {
  await db.withAdmin("seed do teste de isolamento", async (admin) => {
    await admin.insert(user).values([
      { id: A.owner, name: "Ana", email: "ana@example.com" },
      { id: A.viewer, name: "Vi", email: "vi@example.com" },
      { id: A.adult, name: "Adu", email: "adu@example.com" },
      { id: B.owner, name: "Beto", email: "beto@example.com" },
    ]);
    await admin.insert(household).values([
      { id: A.household, name: "Família A", slug: "familia-a" },
      { id: B.household, name: "Família B", slug: "familia-b" },
    ]);
    await admin.insert(householdMember).values([
      { id: "m1", organizationId: A.household, userId: A.owner, role: "owner" },
      { id: "m2", organizationId: A.household, userId: A.viewer, role: "viewer" },
      { id: "m3", organizationId: A.household, userId: A.adult, role: "adult" },
      { id: "m4", organizationId: B.household, userId: B.owner, role: "owner" },
    ]);
  });

  const ctxA = await ctxFor(A.owner, A.household);
  personA = await db.withHousehold(ctxA, async (tx) => {
    const [row] = await tx
      .insert(people)
      .values({ householdId: A.household, name: "Ana", relation: "titular", userId: A.owner })
      .returning({ id: people.id });
    await tx.insert(householdSettings).values({ householdId: A.household });
    await tx.insert(auditLog).values({
      householdId: A.household,
      actorUserId: A.owner,
      actorKind: "user",
      action: "create",
      entity: "people",
    });
    return row!.id;
  });

  const ctxB = await ctxFor(B.owner, B.household);
  personB = await db.withHousehold(ctxB, async (tx) => {
    const [row] = await tx
      .insert(people)
      .values({ householdId: B.household, name: "Beto", relation: "titular" })
      .returning({ id: people.id });
    return row!.id;
  });
});

afterAll(async () => {
  await closeAllPools();
});

describe("isolamento entre households (RLS)", () => {
  it("cada household só enxerga as próprias pessoas", async () => {
    const ctxA = await ctxFor(A.owner, A.household);
    const rows = await db.withHousehold(ctxA, (tx) => tx.select().from(people));
    expect(rows.map((r) => r.id)).toEqual([personA]);
  });

  it("não-membro não obtém contexto de outro household", async () => {
    expect(await db.fromSession(session(B.owner, A.household))).toBeNull();
    expect(await db.fromSession(session(A.owner, "hh-inexistente"))).toBeNull();
  });

  it("sem contexto aplicado, a conexão da aplicação não vê nada (fail-closed)", async () => {
    const raw = postgres(urls.app, { max: 1 });
    try {
      const rows = await raw`select id from people`;
      expect(rows).toHaveLength(0);
      await expect(
        raw`insert into people (household_id, name, relation) values (${A.household}, 'X', 'outro')`,
      ).rejects.toThrow();
    } finally {
      await raw.end();
    }
  });

  it("não grava linha com household_id de outro tenant", async () => {
    const ctxA = await ctxFor(A.owner, A.household);
    await expect(
      db.withHousehold(ctxA, (tx) =>
        tx.insert(people).values({ householdId: B.household, name: "Intruso", relation: "outro" }),
      ),
    ).rejects.toThrow();
  });

  it("não altera nem apaga linha de outro tenant", async () => {
    const ctxA = await ctxFor(A.owner, A.household);
    const updated = await db.withHousehold(ctxA, (tx) =>
      tx.update(people).set({ name: "Hackeado" }).where(eq(people.id, personB)).returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await db.withHousehold(ctxA, (tx) =>
      tx.delete(people).where(eq(people.id, personB)).returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("FK composta impede apontar para pessoa de outro household", async () => {
    const ctxA = await ctxFor(A.owner, A.household);
    await expect(
      db.withHousehold(ctxA, (tx) =>
        tx
          .update(householdSettings)
          .set({ primaryPersonId: personB })
          .where(eq(householdSettings.householdId, A.household)),
      ),
    ).rejects.toThrow();
    // E aceita uma pessoa do próprio household.
    await db.withHousehold(ctxA, (tx) =>
      tx
        .update(householdSettings)
        .set({ primaryPersonId: personA })
        .where(eq(householdSettings.householdId, A.household)),
    );
  });

  it("papel viewer lê mas não escreve", async () => {
    const ctxV = await ctxFor(A.viewer, A.household);
    const rows = await db.withHousehold(ctxV, (tx) => tx.select().from(people));
    expect(rows).toHaveLength(1);
    await expect(
      db.withHousehold(ctxV, (tx) =>
        tx.insert(people).values({ householdId: A.household, name: "Novo", relation: "filho" }),
      ),
    ).rejects.toThrow();
  });

  it("papel adult escreve, mas só o owner lê a auditoria", async () => {
    const ctxAdult = await ctxFor(A.adult, A.household);
    await db.withHousehold(ctxAdult, (tx) =>
      tx.insert(people).values({ householdId: A.household, name: "Filho", relation: "filho" }),
    );
    const auditAsAdult = await db.withHousehold(ctxAdult, (tx) => tx.select().from(auditLog));
    expect(auditAsAdult).toHaveLength(0);
    const ctxOwner = await ctxFor(A.owner, A.household);
    const auditAsOwner = await db.withHousehold(ctxOwner, (tx) => tx.select().from(auditLog));
    expect(auditAsOwner.length).toBeGreaterThan(0);
  });

  it("auditoria é append-only", async () => {
    const ctxOwner = await ctxFor(A.owner, A.household);
    await expect(
      db.withHousehold(ctxOwner, (tx) => tx.update(auditLog).set({ action: "x" })),
    ).rejects.toThrow();
  });

  it("papel 'system' na conexão da web não concede escrita", async () => {
    const ctx = db.fromJob({ householdId: A.household });
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.insert(people).values({ householdId: A.household, name: "Sys", relation: "outro" }),
      ),
    ).rejects.toThrow();
  });

  it("contexto forjado é rejeitado", async () => {
    const forged = { householdId: B.household, userId: A.owner, role: "owner" } as never;
    await expect(db.withHousehold(forged, async () => 1)).rejects.toThrow(/TenantContext inválido/);
  });

  it("worker (ou_worker) grava com papel 'system' apenas no household do job", async () => {
    const raw = postgres(urls.worker, { max: 1 });
    try {
      await raw.begin(async (tx) => {
        await tx`select set_config('app.household_id', ${A.household}, true), set_config('app.role', 'system', true)`;
        await tx`insert into people (household_id, name, relation) values (${A.household}, 'Via job', 'outro')`;
      });
      await expect(
        raw.begin(async (tx) => {
          await tx`select set_config('app.household_id', ${A.household}, true), set_config('app.role', 'system', true)`;
          await tx`insert into people (household_id, name, relation) values (${B.household}, 'Vazou', 'outro')`;
        }),
      ).rejects.toThrow();
      const ok = await raw.begin(async (tx) => {
        await tx`select set_config('app.household_id', ${A.household}, true), set_config('app.role', 'system', true)`;
        return tx`select name from people where name = 'Via job'`;
      });
      expect(ok).toHaveLength(1);
    } finally {
      await raw.end();
    }
  });

  it("admin (BYPASSRLS) enxerga todos os households", async () => {
    const all = await db.withAdmin("verificação do teste", (admin) => admin.select().from(people));
    const households = new Set(all.map((p) => p.householdId));
    expect(households).toEqual(new Set([A.household, B.household]));
  });
});

describe("ops", () => {
  it("registra e lista deploys sem tenant", async () => {
    await db.recordDeployment({ service: "web", commit: "abc1234", hostname: "test" });
    const rows = await db.listDeployments(5);
    expect(rows[0]?.commit).toBe("abc1234");
    const status = await db.databaseStatus();
    expect(status.schemaVersion).toMatch(/^\d{4}_/);
  });
});
