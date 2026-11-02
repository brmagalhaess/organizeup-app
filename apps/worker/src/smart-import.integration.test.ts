// Job `smart-import` contra um Postgres real, com a conexão do worker (`ou_worker`). Sem chave do modelo: prova
// as regras, o isolamento de falha e o registro em `ops`, só com contagens. Dados fictícios.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { SmartImportJob } from "@organizeup/db";

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
const domain = await import("@organizeup/domain");
const agents = await import("@organizeup/agents");
const { runSmartImportJob } = await import("./smart-import");

const FAMILY = "hh-worker-importador";
const PERSON = "user-worker-importador";
const log = { error: () => undefined, info: () => undefined };
const ctx = db.fromJob({ householdId: FAMILY });
const encode = (text: string) => new TextEncoder().encode(text);

const ofx = (id: string) => `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><DTPOSTED>20261001<TRNAMT>-150.00<FITID>${id}<MEMO>MERCADO ${id.toUpperCase()}</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

/** O que a fila faria: cada job lê um arquivo, e o seguinte entra no fim. */
async function drain(first: SmartImportJob) {
  const queue: SmartImportJob[] = [first];
  let jobs = 0;
  while (queue.length > 0) {
    jobs += 1;
    await runSmartImportJob(log, queue.shift()!, async (next) => queue.push(next));
  }
  return jobs;
}

async function lotOf(files: Array<[string, Uint8Array]>) {
  return db.withHousehold(ctx, async (tx) => {
    const importId = (await agents.createSmartImport(tx, ctx))!;
    for (const [name, bytes] of files) {
      const checked = domain.checkSmartFile(bytes, name);
      if (!checked.ok) throw new Error(checked.code);
      await agents.saveSmartFile(tx, ctx, {
        importId,
        fileName: checked.fileName,
        mediaType: checked.mediaType,
        bytes,
      });
    }
    await agents.queueSmartImport(tx, ctx, importId, true);
    return importId;
  });
}

beforeAll(async () => {
  await db.withAdmin("seed do worker", async (admin) => {
    await admin.insert(db.user).values({ id: PERSON, name: "T", email: "t.worker@example.com" });
    await admin.insert(db.household).values({ id: FAMILY, name: "Família", slug: FAMILY });
    await admin
      .insert(db.householdMember)
      .values({ id: `m-${FAMILY}`, organizationId: FAMILY, userId: PERSON, role: "owner" });
  });
  await db.withHousehold(ctx, async (tx) => {
    await tx.insert(db.householdSettings).values({ householdId: FAMILY });
    await db.ensureFinanceDefaults(tx, FAMILY);
  });
});

afterAll(async () => {
  await db.closeAllPools();
});

describe("worker do importador", () => {
  it("lê o lote pelas regras, segue depois de um arquivo quebrado e avisa a família", async () => {
    const importId = await lotOf([
      ["quebrado.pdf", encode("%PDF-1.7 corrompido")],
      ["um.ofx", encode(ofx("um"))],
      ["dois.ofx", encode(ofx("dois"))],
      ["contrato.txt", encode("Contrato sem IA disponível")],
    ]);
    expect(await drain({ householdId: FAMILY, importId })).toBe(4);
    const seen = await db.withHousehold(ctx, async (tx) => ({
      files: await agents.listSmartFiles(tx, importId),
      items: await agents.listSmartItems(tx, importId),
      notices: await tx.select().from(db.householdNotifications),
    }));
    expect(seen.files.map((file) => [file.status, file.failure])).toEqual([
      ["falhou", "ilegivel"],
      ["lido", null],
      ["lido", null],
      ["falhou", "sem_chave"],
    ]);
    expect(seen.items).toHaveLength(2);
    expect(seen.notices.filter((row) => row.kind === "importador")).toHaveLength(1);

    const runs = await db.listAgentRuns();
    const run = runs.find((row) => row.agent === "importador");
    expect(run).toMatchObject({ households: 1, ok: 2, failed: 2, applied: 2, suggestions: 0 });
  });

  it("job repetido não lê de novo, e sem lote é a limpeza", async () => {
    const importId = await lotOf([["tres.ofx", encode(ofx("tres"))]]);
    await drain({ householdId: FAMILY, importId });
    await drain({ householdId: FAMILY, importId });
    const items = await db.withHousehold(ctx, (tx) => agents.listSmartItems(tx, importId));
    expect(items).toHaveLength(1);
    await expect(runSmartImportJob(log, {})).resolves.toBeUndefined();
  });

  it("lote grande não segura outra família: cada job lê um arquivo e vai para o fim", async () => {
    const big = await lotOf([
      ["g1.ofx", encode(ofx("g1"))],
      ["g2.ofx", encode(ofx("g2"))],
      ["g3.ofx", encode(ofx("g3"))],
    ]);
    const small = await lotOf([["p1.ofx", encode(ofx("p1"))]]);
    const order: string[] = [];
    const queue: SmartImportJob[] = [
      { householdId: FAMILY, importId: big },
      { householdId: FAMILY, importId: small },
    ];
    while (queue.length > 0) {
      const job = queue.shift()!;
      order.push(job.importId === big ? "grande" : "pequeno");
      await runSmartImportJob(log, job, async (next) => queue.push(next));
    }
    expect(order).toEqual(["grande", "pequeno", "grande", "grande"]);
  });

  it("família apagada no meio: o job termina, sem repetir", async () => {
    await expect(
      runSmartImportJob(log, { householdId: "hh-que-nao-existe", importId: "lote" }),
    ).resolves.toBeUndefined();
  });

  it("nada de texto em `ops`: a rodada só guarda contagens", async () => {
    const runs = await db.listAgentRuns();
    expect(JSON.stringify(runs)).not.toMatch(/MERCADO|contrato/i);
  });
});
