// Arquivos maliciosos de verdade, pelo caminho inteiro: passam pela conferência de tipo, entram no lote e vão ao
// processo isolado, com banco real. Mede tempo e memória do processo que representa o worker, e imprime os números.
import { deflateRawSync, deflateSync } from "node:zlib";
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
const ai = { ...(await import("../src/index")), ...(await import("../src/importador/run")) };

const A = { household: "hh-bomba", owner: "user-bomba" };
const limits = { monthlyBudgetUsd: 1000, familyDailyTokens: 1_000_000 };
const MB = 1024 * 1024;
let owner: TenantContext;

function zipEntry(name: string, raw: Buffer, offset: number) {
  const data = deflateRawSync(raw, { level: 9 });
  const title = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length > 1000 ? 1000 : raw.length, 22);
  local.writeUInt16LE(title.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  // Passa pela conferência da porta: diz que descomprime em 1 KB.
  central.writeUInt32LE(raw.length > 1000 ? 1000 : raw.length, 24);
  central.writeUInt16LE(title.length, 28);
  central.writeUInt32LE(offset, 42);
  return {
    body: Buffer.concat([local, title, data]),
    central: Buffer.concat([central, title]),
  };
}

function xlsxBomb(size: number): Buffer {
  let offset = 0;
  const entries = (
    [
      ["[Content_Types].xml", Buffer.from("<Types/>")],
      ["xl/workbook.xml", Buffer.alloc(size, " ")],
    ] as Array<[string, Buffer]>
  ).map(([name, raw]) => {
    const entry = zipEntry(name, raw, offset);
    offset += entry.body.length;
    return entry;
  });
  const body = Buffer.concat(entries.map((entry) => entry.body));
  const directory = Buffer.concat(entries.map((entry) => entry.central));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, directory, end]);
}

function pdfBomb(size: number): Buffer {
  const content = deflateSync(Buffer.alloc(size, " "), { level: 9 });
  return Buffer.concat([
    Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj
4 0 obj<</Length ${content.length}/Filter/FlateDecode>>stream
`),
    content,
    Buffer.from("\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF"),
  ]);
}

/** PDF com o filtro escondido de quem varre fluxos: dois níveis de compressão. O vigia de memória responde. */
function nestedPdfBomb(size: number): Buffer {
  const inner = deflateSync(Buffer.alloc(size, " "), { level: 9 });
  const content = deflateSync(inner, { level: 9 });
  return Buffer.concat([
    Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj
4 0 obj<</Length ${content.length}/Filter[/FlateDecode/FlateDecode]>>stream
`),
    content,
    Buffer.from("\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF"),
  ]);
}

async function readOne(name: string, bytes: Uint8Array) {
  const importId = await db.withHousehold(owner, async (tx) => {
    const id = (await agents.createSmartImport(tx, owner))!;
    const checked = domain.checkSmartFile(bytes, name);
    if (!checked.ok) throw new Error(checked.code);
    await agents.saveSmartFile(tx, owner, {
      importId: id,
      fileName: checked.fileName,
      mediaType: checked.mediaType,
      bytes,
    });
    await agents.queueSmartImport(tx, owner, id, false);
    return id;
  });
  const before = process.memoryUsage().rss;
  const started = Date.now();
  await ai.runSmartImport({ ctx: owner, client: null, importId, limits, day: domain.todayIn() });
  const seconds = (Date.now() - started) / 1000;
  const parentGrowthMb = (process.memoryUsage().rss - before) / MB;
  const [file] = await db.withHousehold(owner, (tx) => agents.listSmartFiles(tx, importId));
  console.log(
    JSON.stringify({
      arquivo: name,
      tamanhoMb: +(bytes.length / MB).toFixed(2),
      falha: file!.failure,
      segundos: seconds,
      memoriaDoPaiMb: +parentGrowthMb.toFixed(1),
    }),
  );
  return { file: file!, seconds, parentGrowthMb };
}

beforeAll(async () => {
  await db.withAdmin("seed das bombas", async (admin) => {
    await admin.insert(db.user).values({ id: A.owner, name: "B", email: "b.bomba@example.com" });
    await admin.insert(db.household).values({ id: A.household, name: "F", slug: A.household });
    await admin
      .insert(db.householdMember)
      .values({ id: "m-bomba", organizationId: A.household, userId: A.owner, role: "owner" });
  });
  owner = (await db.fromSession({
    user: { id: A.owner },
    session: { activeOrganizationId: A.household },
  }))!;
  await db.withHousehold(owner, (tx) =>
    tx.insert(db.householdSettings).values({ householdId: A.household }),
  );
});

afterAll(async () => {
  await db.closeAllPools();
});

const WITHIN_S = 35;
const PARENT_MB = 120;

describe("arquivos maliciosos", () => {
  it("XLSX de 1 GB inflado, com tamanho mentiroso", { timeout: 60_000 }, async () => {
    const { file, seconds, parentGrowthMb } = await readOne("planilha.xlsx", xlsxBomb(1024 * MB));
    expect(file).toMatchObject({ status: "falhou", failure: "bomba" });
    expect(seconds).toBeLessThan(WITHIN_S);
    expect(parentGrowthMb).toBeLessThan(PARENT_MB);
  });

  it("PDF de 1 GB inflado", { timeout: 60_000 }, async () => {
    const { file, seconds, parentGrowthMb } = await readOne("contrato.pdf", pdfBomb(1024 * MB));
    expect(file).toMatchObject({ status: "falhou", failure: "bomba" });
    expect(seconds).toBeLessThan(WITHIN_S);
    expect(parentGrowthMb).toBeLessThan(PARENT_MB);
  });

  it("PDF com dois níveis de compressão: quem para é o vigia", { timeout: 60_000 }, async () => {
    const { file, seconds, parentGrowthMb } = await readOne(
      "aninhado.pdf",
      nestedPdfBomb(1024 * MB),
    );
    expect(file.status).toBe("falhou");
    expect(["bomba", "demorado", "ilegivel"]).toContain(file.failure);
    expect(seconds).toBeLessThan(WITHIN_S);
    expect(parentGrowthMb).toBeLessThan(PARENT_MB);
  });

  it("XML de 10 MB feito para travar expressão regular", { timeout: 60_000 }, async () => {
    const bytes = new TextEncoder().encode(`<a>${"<infNFe ".repeat(1_250_000)}</a>`);
    const { file, seconds } = await readOne("nota.xml", bytes);
    expect(file.status).toBe("falhou");
    expect(seconds).toBeLessThan(10);
  });

  it(
    "CSV grande de verdade é lido, e para em 5.000 itens com aviso",
    { timeout: 60_000 },
    async () => {
      const lines = Array.from(
        { length: 200_000 },
        (_, index) => `01/10/2026;Compra numero ${index % 97};-${(index % 900) + 1},00`,
      );
      const bytes = new TextEncoder().encode(`data;descricao;valor\n${lines.join("\n")}`);
      const { file, seconds } = await readOne("extrato.csv", bytes);
      expect(file).toMatchObject({ status: "lido", method: "regras" });
      expect(file.notes).toContain("codigo:itens_cortados:200000");
      expect(seconds).toBeLessThan(WITHIN_S);
    },
  );

  it("TXT de 10 MB de uma linha só, parecendo extrato", { timeout: 60_000 }, async () => {
    const bytes = new TextEncoder().encode(`extrato saldo\n01/10/2026 ${"1.".repeat(5_000_000)}`);
    const { file, seconds } = await readOne("extrato.txt", bytes);
    expect(file.status).toBe("falhou");
    expect(seconds).toBeLessThan(WITHIN_S);
  });
});
