// O lote que travou o worker por 406 s: 10 CSVs de 5.000 linhas com o mesmo valor. Mede o maior bloqueio do processo
// enquanto lê e compara, com banco real, e imprime os números. O limite protege a promessa da ADR-0030 (nada
// de bloqueio longo no worker) e o bloqueio é medido em tempo de CPU, não em tempo de parede: ver ORG-256.
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
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

// Bloqueio em tempo de CPU da própria thread, e não em tempo de parede. Em máquina de CPU disputada a volta
// do laço atrasa sem o nosso código rodar nada, e o número de parede inflava sozinho: o mesmo commit de
// `main` mediu 920 ms numa hora e 2.262 ms em outra, sem regressão nenhuma (ORG-256). O que a ADR-0030 protege é a
// comparação do lote não voltar a ser quadrática dentro do worker, e isso gasta CPU segurando o laço: a cada
// volta compara quanto o laço demorou com quanta CPU esta thread queimou e guarda o menor dos dois, porque
// CPU gasta não pode contar como bloqueio além do tempo que a volta levou.
// O que esta medida deixa de pegar: trabalho pesado dentro do processo filho (`planInChild`), que tem tempo-limite
// próprio (`SMART_PLAN_TIMEOUT_MS`). A volta por regra quando o filho não responde (`planSmartReview`) roda aqui
// no pai e continua contando. O tempo de parede segue impresso, só não reprova o teste.
const watchBlockingCpu = (resolutionMs = 10) => {
  let wall = performance.now();
  let cpu = process.threadCpuUsage();
  let worstMs = 0;
  const timer = setInterval(() => {
    const nextWall = performance.now();
    const nextCpu = process.threadCpuUsage();
    const cpuGapMs = (nextCpu.user - cpu.user + nextCpu.system - cpu.system) / 1_000;
    worstMs = Math.max(worstMs, Math.min(nextWall - wall, cpuGapMs));
    wall = nextWall;
    cpu = nextCpu;
  }, resolutionMs);
  return {
    stop: () => {
      clearInterval(timer);
      return worstMs;
    },
  };
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
  it("10 CSVs de 5.000 linhas não bloqueiam o processo por mais de 1 s de CPU", async () => {
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
    const blocking = watchBlockingCpu();
    const started = Date.now();
    delay.enable();
    await ai.runSmartImport({ ctx: owner, client: null, importId, limits, day: "2026-11-02" });
    delay.disable();
    const blockedMs = blocking.stop();
    const waitedMs = delay.max / 1e6;
    console.log(
      `lote grande: ${Date.now() - started} ms, maior bloqueio ${Math.round(blockedMs)} ms de CPU ` +
        `(maior volta do laço ${Math.round(waitedMs)} ms, inclui espera pela máquina)`,
    );

    const summary = await db.withHousehold(owner, (tx) =>
      agents.summarizeSmartItems(tx, importId, []),
    );
    expect(summary.total).toBe(50_000);
    // Segue o 1 s da ADR-0030, sem folga: o limite não precisou subir. Antes da ORG-258 a CPU por arquivo
    // chegava a 1.146 ms e empurrava o teste contra o teto; normalizar as palavras-chave uma vez tirou
    // ~0,5 s do pico, e o que sobra é bem menos que o limite. Se um dia voltar a reprovar, o número não é
    // o lugar de mexer: ou a fase ficou mais cara de verdade, e o reparo é no importador (ORG-257).
    expect(blockedMs).toBeLessThan(1_000);
  }, 300_000);
});
