// Proventos pelo importador de arquivos (ADR-0030): a mesma comparação e a mesma gravação de `/app/proventos/importar`,
// provadas na conversa com o Mercado e com o Desfazer (ADR-0029). Web como ou_app, job como ou_worker. Dados fictícios.
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { MarketDividendRow, TenantContext, TenantTx } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;
process.env.ANTHROPIC_API_KEY = "chave-de-teste";

vi.mock("@/lib/diagnostics", () => ({ reportActionFailure: () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const db = await import("@organizeup/db");
const domain = await import("@organizeup/domain");
const agents = await import("@organizeup/agents");
const ai = { ...(await import("@organizeup/ai")), ...(await import("@organizeup/ai/importador")) };
const { approveSmartImport } = await import("./commit");

const { dividends, eq, household, householdMember, householdSettings } = db;
const { householdSuggestions, investments, investmentTrades, smartImportItems } = db;
const { smartImports, transactions, user } = db;

const FAMILY = "hh-imp-prov";
const OWNER = "user-imp-prov";
const limits = { monthlyBudgetUsd: 1000, familyDailyTokens: 1_000_000 };
const today = "2026-11-02";
let owner: TenantContext;
let ticker = "";
let round = 0;

async function asWorker<T>(fn: () => Promise<T>): Promise<T> {
  process.env.DATABASE_URL = urls.worker;
  try {
    return await fn();
  } finally {
    process.env.DATABASE_URL = urls.app;
  }
}

const inFamily = <T>(fn: (tx: TenantTx) => Promise<T>) =>
  asWorker(() => db.withWorkerHousehold(FAMILY, fn));

const mercado = () =>
  inFamily((tx) => agents.runInvestimentosAgent(tx, { today, householdId: FAMILY }));

const provento = (over: Partial<MarketDividendRow> = {}): MarketDividendRow => ({
  ticker,
  kind: "dividendo",
  comDate: "2026-02-20",
  exDate: null,
  payDate: "2026-03-10",
  ratePerShare: "0.5",
  seq: 1,
  source: "brapi.dev",
  ...over,
});

const seedMarket = (rows: MarketDividendRow[]) => asWorker(() => db.saveMarketDividends(rows));
const stored = () => inFamily((tx) => tx.select().from(dividends));

const csv = (rows: Array<[code: string, date: string, net: string]>) =>
  `Produto;Tipo de Evento;Data de pagamento;Quantidade;Valor líquido\n${rows
    .map(([code, date, net]) => `${code};Dividendo;${date};100;${net}`)
    .join("\n")}\n`;

/** Envia, lê e deixa tudo visto, como a tela. */
async function readFile(text: string) {
  const bytes = new TextEncoder().encode(text);
  const importId = await db.withHousehold(owner, async (tx) => {
    const id = (await agents.createSmartImport(tx, owner))!;
    const checked = domain.checkSmartFile(bytes, `${id}.csv`);
    if (!checked.ok) throw new Error(checked.code);
    await agents.saveSmartFile(tx, owner, {
      importId: id,
      fileName: checked.fileName,
      mediaType: checked.mediaType,
      bytes,
    });
    await agents.queueSmartImport(tx, owner, id, true);
    return id;
  });
  await ai.runSmartImport({ ctx: owner, client: null, importId, limits, day: today });
  await db.withHousehold(owner, (tx) =>
    tx.update(smartImportItems).set({ seen: true }).where(eq(smartImportItems.importId, importId)),
  );
  const items = await db.withHousehold(owner, (tx) => agents.listSmartItems(tx, importId));
  return { importId, items };
}

beforeAll(async () => {
  await db.withAdmin("seed de proventos do importador", async (admin) => {
    await admin.insert(user).values({ id: OWNER, name: "Dona", email: "dona-imp@example.com" });
    await admin.insert(household).values({ id: FAMILY, name: "Família", slug: FAMILY });
    await admin
      .insert(householdMember)
      .values({ id: "mi-prov", organizationId: FAMILY, userId: OWNER, role: "owner" });
  });
  const found = await db.fromSession({
    user: { id: OWNER },
    session: { activeOrganizationId: FAMILY },
  });
  if (!found) throw new Error("sem contexto");
  owner = found;
  await db.withHousehold(owner, async (tx) => {
    await tx.insert(householdSettings).values({ householdId: FAMILY });
    await db.ensureFinanceDefaults(tx, FAMILY);
  });
  await ai.activateAssistant(owner, { autonomy: "organizar", version: "2026-11-02.1" });
  await ai.acceptImporterFiles(owner, ai.IMPORTER_CONSENT_VERSION);
});

beforeEach(async () => {
  round += 1;
  ticker = `TI${String.fromCharCode(65 + Math.floor(round / 26), 65 + (round % 26))}3`;
  await inFamily(async (tx) => {
    await tx.delete(smartImports);
    await tx.delete(dividends);
    await tx.delete(householdSuggestions);
    await tx.delete(investments);
    const [created] = await tx
      .insert(investments)
      .values({ householdId: FAMILY, name: "ABCD SA", ticker, assetClass: "acao" })
      .returning({ id: investments.id });
    await tx.insert(investmentTrades).values({
      householdId: FAMILY,
      investmentId: created!.id,
      side: "compra",
      occurredOn: "2026-01-05",
      quantity: "100",
      unitPrice: "10",
      fees: "0.00",
    });
  });
});

afterAll(() => db.closeAllPools());

describe("proventos pelo importador", () => {
  it("CSV de proventos vira provento, com a marca de importado, e nunca lançamento", async () => {
    const { importId, items } = await readFile(csv([[ticker, "10/03/2026", "50,00"]]));
    // A linha vira provento, e o documento é o próprio arquivo.
    expect(items.map((row) => row.destination)).toEqual(["provento", "documento"]);
    expect(await approveSmartImport(owner, importId)).toMatchObject({ saved: 2, failed: 0 });
    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(domain.isImportedDividend(rows[0]!.id)).toBe(true);
    expect(await inFamily((tx) => tx.select().from(transactions))).toEqual([]);
    const [item] = await db.withHousehold(owner, (tx) =>
      tx.select().from(smartImportItems).where(eq(smartImportItems.importId, importId)),
    );
    expect(item).toMatchObject({ status: "gravado", resultId: rows[0]!.id });
  });

  it("Mercado depois: a linha importada responde pelo provento, sem duplicar", async () => {
    const { importId } = await readFile(csv([[ticker, "10/03/2026", "50,00"]]));
    await approveSmartImport(owner, importId);
    await seedMarket([provento()]);
    await mercado();
    await mercado();
    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "familia", marketDividendId: null, gross: "50.00" });
  });

  it("Mercado antes: o que ele criou vem como já lançado, e nada duplica", async () => {
    await seedMarket([provento()]);
    await mercado();
    expect(await stored()).toMatchObject([{ source: "agente" }]);
    const { importId, items } = await readFile(csv([[ticker, "10/03/2026", "50,00"]]));
    expect(items[0]).toMatchObject({ duplicate: "ja_lancado", selected: false });
    await db.withHousehold(owner, (tx) =>
      tx
        .update(smartImportItems)
        .set({ selected: true })
        .where(eq(smartImportItems.importId, importId)),
    );
    expect(await approveSmartImport(owner, importId)).toMatchObject({ saved: 1, existed: 1 });
    await mercado();
    expect(await stored()).toHaveLength(1);
  });

  it("valor diferente: marcar troca a linha automática, como na tela de Proventos", async () => {
    await seedMarket([provento()]);
    await mercado();
    const { importId, items } = await readFile(csv([[ticker, "10/03/2026", "60,00"]]));
    expect(items[0]).toMatchObject({ duplicate: "possivel", selected: false });
    await db.withHousehold(owner, (tx) =>
      tx
        .update(smartImportItems)
        .set({ selected: true })
        .where(eq(smartImportItems.importId, importId)),
    );
    expect(await approveSmartImport(owner, importId)).toMatchObject({ saved: 2, failed: 0 });
    await mercado();
    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "familia", gross: "60.00" });
  });

  it("Desfazer da remoção não recria o automático ao lado da importada", async () => {
    await seedMarket([provento()]);
    await mercado();
    await inFamily((tx) => tx.update(investmentTrades).set({ occurredOn: "2026-02-25" }));
    await mercado();
    expect(await stored()).toHaveLength(0);
    const { importId, items } = await readFile(csv([[ticker, "10/03/2026", "50,00"]]));
    await db.withHousehold(owner, (tx) =>
      tx
        .update(smartImportItems)
        .set({ selected: true })
        .where(eq(smartImportItems.id, items[0]!.id)),
    );
    await approveSmartImport(owner, importId);
    const suggestions = await inFamily((tx) =>
      tx.select().from(householdSuggestions).where(eq(householdSuggestions.status, "aplicada")),
    );
    const removal = suggestions.find((row) => JSON.stringify(row.payload).includes('"removed":[{'));
    const undone = await db.withHousehold(owner, (tx) =>
      agents.undoSuggestion(tx, owner, removal!.id),
    );
    expect(undone).toMatchObject({ ok: true });
    expect(await stored()).toMatchObject([{ source: "familia", marketDividendId: null }]);
  });

  it("mesmo arquivo em dois lotes grava uma vez só", async () => {
    const text = csv([[ticker, "10/03/2026", "50,00"]]);
    const first = await readFile(text);
    await approveSmartImport(owner, first.importId);
    const second = await readFile(`${text}\n`);
    expect(second.items[0]).toMatchObject({ duplicate: "ja_lancado", selected: false });
    await approveSmartImport(owner, second.importId);
    expect(await stored()).toHaveLength(1);
  });
});
