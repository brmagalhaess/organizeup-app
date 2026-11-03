// O lote que travou o worker por 406 s: 10 CSVs de 5.000 linhas com o mesmo valor. Mede o maior bloqueio do processo
// enquanto lê e compara, com banco real, e imprime os números. Nenhum bloqueio acima de 1 s (ADR-0030).
import { monitorEventLoopDelay } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TenantContext } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;

const db = await import("@organizeup/db");
const domain = await import("@organizeup/domain");
const agents = await import("@organizeup/agents");
const ai = await import("../src/importador/run");

const FAMILY = "hh-lote-grande";
const OWNER = "user-lote-grande";
const limits = { monthlyBudgetUsd: 1000, familyDailyTokens: 1_000_000 };
let owner: TenantContext;

const LINES = 5_000;
const csvOf = (seed: number) => {
  const rows = Array.from({ length: LINES }, (_, index) => {
    const day = String((index % 28) + 1).padStart(2, "0");
    const month = String((seed % 9) + 1).padStart(2, "0");
    return `${day}/${month}/2026;COMPRA ${seed} ${index};-10,00`;
  });
  return `Data;Descrição;Valor\n${rows.join("\n")}\n`;
};

beforeAll(async () => {
  await db.withAdmin("seed do lote grande", async (admin) => {
    await admin.insert(db.user).values({ id: OWNER, name: "T", email: "lote@example.com" });
    await admin.insert(db.household).values({ id: FAMILY, name: "Família", slug: FAMILY });
    await admin
      .insert(db.householdMember)
      .values({ id: "m-lote", organizationId: FAMILY, userId: OWNER, role: "owner" });
  });
  const found = await db.fromSession({
    user: { id: OWNER },
    session: { activeOrganizationId: FAMILY },
  });
  if (!found) throw new Error("sem contexto");
  owner = found;
  await db.withHousehold(owner, async (tx) => {
    await tx.insert(db.householdSettings).values({ householdId: FAMILY });
    await db.ensureFinanceDefaults(tx, FAMILY);
  });
});

afterAll(() => db.closeAllPools());

describe("lote grande de valores iguais", () => {
  it("10 CSVs de 5.000 linhas não bloqueiam o processo por mais de 1 s", async () => {
    const importId = await db.withHousehold(owner, async (tx) => {
      const id = (await agents.createSmartImport(tx, owner))!;
      for (let seed = 0; seed < 10; seed += 1) {
        const bytes = new TextEncoder().encode(csvOf(seed));
        const checked = domain.checkSmartFile(bytes, `extrato-${seed}.csv`);
        if (!checked.ok) throw new Error(checked.code);
        const saved = await agents.saveSmartFile(tx, owner, {
          importId: id,
          fileName: checked.fileName,
          mediaType: checked.mediaType,
          bytes,
        });
        if (!saved.ok) throw new Error(saved.code);
      }
      await agents.queueSmartImport(tx, owner, id, true);
      return id;
    });

    const delay = monitorEventLoopDelay({ resolution: 10 });
    const started = Date.now();
    delay.enable();
    await ai.runSmartImport({ ctx: owner, client: null, importId, limits, day: "2026-11-02" });
    delay.disable();
    const blockedMs = delay.max / 1e6;
    console.log(
      `lote grande: ${Date.now() - started} ms, maior bloqueio ${Math.round(blockedMs)} ms`,
    );

    const summary = await db.withHousehold(owner, (tx) =>
      agents.summarizeSmartItems(tx, importId, []),
    );
    expect(summary.total).toBe(50_000);
    expect(blockedMs).toBeLessThan(1_000);
  }, 300_000);
});
