// Importar proventos (ADR-0029), pelas server actions de verdade, contra um Postgres real, com a web conectada
// como ou_app e o job como ou_worker. Prova a conversa com o Mercado nas duas ordens, a transação única, a
// confirmação que reconfere, quem pode e o isolamento. Dados fictícios.
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

let ctx: TenantContext;
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { messagesFor } = await import("@/i18n/messages");
  return {
    getLocale: async () => "pt-BR",
    getMessages: async () => messagesFor("pt-BR"),
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "pt-BR", messages: messagesFor("pt-BR"), namespace } as never),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({ requireTenant: async () => ({ ctx }) }));

const db = await import("@organizeup/db");
const agents = await import("@organizeup/agents");
const { commitDividendImport, prepareDividendImport } =
  await import("@/app/app/(painel)/proventos/importar/actions");
const { deleteDividend } = await import("@/app/app/(painel)/proventos/actions");
const { loadDividends } = await import("@/lib/investments");

const { auditLog, dividends, eq, household, householdMember, householdSettings } = db;
const { householdSuggestions, investments, investmentTrades, transactions, user } = db;

const A = { household: "hh-prov-a", owner: "user-prov-a", viewer: "user-prov-v" };
const B = { household: "hh-prov-b", owner: "user-prov-b" };
const today = "2026-11-02";

/** O job roda com a credencial dele: a web, como ou_app, não grava nas tabelas de mercado. */
async function asWorker<T>(fn: () => Promise<T>): Promise<T> {
  process.env.DATABASE_URL = urls.worker;
  try {
    return await fn();
  } finally {
    process.env.DATABASE_URL = urls.app;
  }
}

const inA = <T>(fn: (tx: TenantTx) => Promise<T>) =>
  asWorker(() => db.withWorkerHousehold(A.household, fn));
const inB = <T>(fn: (tx: TenantTx) => Promise<T>) =>
  asWorker(() => db.withWorkerHousehold(B.household, fn));

const mercado = (householdId = A.household) =>
  asWorker(() =>
    db.withWorkerHousehold(householdId, (tx) =>
      agents.runInvestimentosAgent(tx, { today, householdId }),
    ),
  );

let owner: TenantContext;
let viewer: TenantContext;
let other: TenantContext;
// As tabelas de mercado são globais e ninguém apaga: cada teste tem um código só dele.
let ticker = "";
let round = 0;
let abcd = "";
let fict = "";
let semCodigo = "";

const purchase = {
  householdId: A.household,
  side: "compra" as const,
  occurredOn: "2026-01-05",
  quantity: "100",
  unitPrice: "10",
  fees: "0.00",
};

const session = async (userId: string, householdId: string) => {
  const found = await db.fromSession({
    user: { id: userId },
    session: { activeOrganizationId: householdId },
  });
  if (!found) throw new Error("sem contexto");
  return found;
};

interface Line {
  line: number;
  ticker?: string;
  kind?: "dividendo" | "jcp" | "rendimento";
  paidOn?: string;
  gross?: string | null;
  withheld?: string | null;
  net?: string | null;
}

const line = (row: Line) => ({
  ticker,
  kind: "dividendo" as const,
  paidOn: "2026-03-10",
  gross: null,
  withheld: null,
  net: "50.00",
  ...row,
});

const file = (rows: Line[], assignments: Record<string, string> = {}) => ({
  rows: rows.map(line),
  assignments,
});

const prepared = async (rows: Line[], assignments: Record<string, string> = {}) => {
  const result = await prepareDividendImport(file(rows, assignments));
  if (!result.ok) throw new Error(result.message);
  return result;
};
const statesOf = async (rows: Line[]) => (await prepared(rows)).rows.map((row) => row.state);

const send = (rows: Line[], over: Record<string, unknown> = {}) =>
  commitDividendImport({
    ...file(rows),
    selected: rows.map((row) => row.line),
    ...over,
  });

const stored = () =>
  inA((tx) => tx.select().from(dividends).orderBy(dividends.paidOn, dividends.kind));

const provento = (over: Partial<MarketDividendRow>): MarketDividendRow => ({
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

beforeAll(async () => {
  await db.withAdmin("seed do teste de proventos", async (admin) => {
    await admin.insert(user).values([
      { id: A.owner, name: "Dona", email: "dona-prov@example.com" },
      { id: A.viewer, name: "Leitora", email: "leitora-prov@example.com" },
      { id: B.owner, name: "Vizinha", email: "vizinha-prov@example.com" },
    ]);
    await admin.insert(household).values([
      { id: A.household, name: "Prov A", slug: A.household },
      { id: B.household, name: "Prov B", slug: B.household },
    ]);
    await admin.insert(householdMember).values([
      { id: "mp-a", organizationId: A.household, userId: A.owner, role: "owner" },
      { id: "mp-v", organizationId: A.household, userId: A.viewer, role: "viewer" },
      { id: "mp-b", organizationId: B.household, userId: B.owner, role: "owner" },
    ]);
  });
  owner = await session(A.owner, A.household);
  viewer = await session(A.viewer, A.household);
  other = await session(B.owner, B.household);
  await inA(async (tx) => {
    await tx.insert(householdSettings).values({ householdId: A.household });
    const rows = await tx
      .insert(investments)
      .values([
        { householdId: A.household, name: "Fundo Fict", ticker: "FICT11", assetClass: "fii" },
        { householdId: A.household, name: "Sem código", assetClass: "outro" },
      ])
      .returning({ id: investments.id, ticker: investments.ticker });
    fict = rows.find((row) => row.ticker === "FICT11")!.id;
    semCodigo = rows.find((row) => row.ticker === null)!.id;
    await tx.insert(investmentTrades).values({ ...purchase, investmentId: fict });
  });
  await inB(async (tx) => {
    await tx.insert(householdSettings).values({ householdId: B.household });
    await tx
      .insert(investments)
      .values({ householdId: B.household, name: "ABCD SA", ticker: "TSTB3", assetClass: "acao" });
  });
});

beforeEach(async () => {
  ctx = owner;
  round += 1;
  ticker = `TST${String.fromCharCode(64 + round)}3`;
  await inA(async (tx) => {
    await tx.delete(dividends);
    await tx.delete(householdSuggestions);
    if (abcd) await tx.delete(investments).where(eq(investments.id, abcd));
    const [created] = await tx
      .insert(investments)
      .values({ householdId: A.household, name: "ABCD SA", ticker, assetClass: "acao" })
      .returning({ id: investments.id });
    abcd = created!.id;
    await tx.insert(investmentTrades).values({ ...purchase, investmentId: abcd });
  });
  await inB(async (tx) => {
    await tx.delete(dividends);
    await tx.update(investments).set({ ticker });
  });
});

afterAll(() => db.closeAllPools());

describe("Mercado antes e depois da importação", () => {
  it("Mercado antes: o que ele criou aparece como já existe, e nada duplica", async () => {
    await seedMarket([provento({})]);
    await mercado();
    expect(await stored()).toMatchObject([{ source: "agente", gross: "50.00" }]);

    const rows: Line[] = [{ line: 1 }];
    expect(await statesOf(rows)).toEqual(["existe"]);
    expect(await send(rows)).toMatchObject({ ok: true, created: 0, skipped: 1 });
    await mercado();
    expect(await stored()).toHaveLength(1);
  });

  it("Mercado depois: a linha importada responde pelo provento, sem duplicar", async () => {
    expect(await send([{ line: 1 }])).toMatchObject({ ok: true, created: 1 });
    await seedMarket([provento({})]);
    await mercado();
    await mercado();
    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "familia", marketDividendId: null, gross: "50.00" });
  });

  it("Mercado depois: não bloqueia o JCP do mesmo dia nem outro pagamento na janela", async () => {
    await send([{ line: 1 }]);
    await seedMarket([
      provento({}),
      provento({ kind: "jcp", ratePerShare: "1" }),
      provento({ payDate: "2026-03-12", comDate: "2026-02-21", ratePerShare: "0.2" }),
    ]);
    await mercado();
    const rows = await stored();
    expect(rows.map((row) => [row.kind, row.source, row.gross])).toEqual(
      expect.arrayContaining([
        ["dividendo", "familia", "50.00"],
        ["jcp", "agente", "100.00"],
        ["dividendo", "agente", "20.00"],
      ]),
    );
    expect(rows).toHaveLength(3);
  });

  it("a regra do lançamento à mão continua: ele cobre o que está na janela", async () => {
    await inA((tx) =>
      tx.insert(dividends).values({
        householdId: A.household,
        investmentId: abcd,
        kind: "dividendo",
        paidOn: "2026-03-10",
        gross: "150.00",
      }),
    );
    await seedMarket([provento({}), provento({ kind: "jcp", ratePerShare: "1" })]);
    await mercado();
    expect(await stored()).toHaveLength(1);
  });

  it("Mercado no meio: importa, ele roda, e reimportar segue sem duplicar", async () => {
    const rows: Line[] = [{ line: 1 }, { line: 2, paidOn: "2026-04-10" }];
    await send([{ line: 1 }]);
    await seedMarket([
      provento({}),
      provento({ payDate: "2026-04-10", comDate: "2026-03-20", ratePerShare: "0.5" }),
    ]);
    await mercado();
    expect(await statesOf(rows)).toEqual(["existe", "existe"]);
    expect(await send(rows)).toMatchObject({ created: 0 });
    await mercado();
    expect(await stored()).toHaveLength(2);
  });

  it("valor diferente: marcar troca a linha automática e o job deixa de mexer nela", async () => {
    await seedMarket([provento({})]);
    await mercado();
    const rows: Line[] = [{ line: 1, net: "70.00" }];
    const [row] = (await prepared(rows)).rows;
    expect(row).toMatchObject({ state: "conferir", doubtReason: "valor_diferente" });
    expect(await send(rows)).toMatchObject({ ok: true, created: 0, replaced: 1 });
    await mercado();
    const after = await stored();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ source: "familia", gross: "70.00" });
    expect(after[0]!.marketDividendId).not.toBeNull();
    expect(await statesOf(rows)).toEqual(["existe"]);
  });

  it("sem marcar, a linha automática fica como está", async () => {
    await seedMarket([provento({})]);
    await mercado();
    await send([{ line: 1, net: "70.00" }], { selected: [] });
    expect(await stored()).toMatchObject([{ source: "agente", gross: "50.00" }]);
  });

  it("JCP de 2026 só com líquido usa a data-com da fonte e o Mercado concorda", async () => {
    await seedMarket([provento({ kind: "jcp", ratePerShare: "1" })]);
    const rows: Line[] = [{ line: 1, kind: "jcp", net: "82.50" }];
    expect((await prepared(rows)).rows[0]).toMatchObject({
      state: "novo",
      calculation: "jcp_do_liquido",
      amounts: { gross: "100.00", withheld: "17.50" },
    });
    await send(rows);
    await mercado();
    expect(await stored()).toMatchObject([
      { kind: "jcp", gross: "100.00", withheld: "17.50", source: "familia" },
    ]);
  });

  it("provento excluído pede conferência e, marcado, não traz o automático junto", async () => {
    await seedMarket([provento({})]);
    await mercado();
    const [auto] = await stored();
    const form = new FormData();
    form.set("id", auto!.id);
    await deleteDividend(form);
    const rows: Line[] = [{ line: 1 }];
    expect((await prepared(rows)).rows[0]).toMatchObject({
      state: "conferir",
      doubtReason: "excluido",
    });
    await send(rows);
    await mercado();
    expect(await stored()).toMatchObject([{ source: "familia", marketDividendId: null }]);
  });

  it("importação e job ao mesmo tempo ficam em fila e não duplicam", async () => {
    await seedMarket([provento({})]);
    // O pool é escolhido na hora da chamada: cada lado segue com a própria credencial.
    process.env.DATABASE_URL = urls.worker;
    const job = db.withWorkerHousehold(A.household, (tx) =>
      agents.runInvestimentosAgent(tx, { today, householdId: A.household }),
    );
    process.env.DATABASE_URL = urls.app;
    const [, commit] = await Promise.all([job, send([{ line: 1 }])]);
    expect(commit).toMatchObject({ ok: true });
    await mercado();
    expect(await stored()).toHaveLength(1);
  });
});

describe("confirmar", () => {
  it("nada grava sem confirmar, e a prévia só lê", async () => {
    await prepared([{ line: 1 }]);
    expect(await stored()).toHaveLength(0);
    expect(await send([{ line: 1 }], { selected: [] })).toMatchObject({ created: 0 });
    expect(await stored()).toHaveLength(0);
  });

  it("grava o valor certo, na tela de Proventos, sem lançamento nem receita", async () => {
    await send([
      { line: 1 },
      { line: 2, kind: "jcp", gross: "100.00", withheld: "15.00", net: "85.00" },
      { line: 3, ticker: "FICT11", kind: "rendimento", paidOn: "2026-02-10", net: "10.00" },
    ]);
    const rows = await stored();
    expect(rows.map((row) => [row.investmentId, row.kind, row.gross, row.withheld])).toEqual([
      [fict, "rendimento", "10.00", "0.00"],
      [abcd, "dividendo", "50.00", "0.00"],
      [abcd, "jcp", "100.00", "15.00"],
    ]);
    expect(await inA((tx) => tx.select().from(transactions))).toHaveLength(0);
    expect((await loadDividends(owner)).rows).toHaveLength(3);
    const logged = await inA((tx) =>
      tx.select().from(auditLog).where(eq(auditLog.entity, "dividends")),
    );
    expect(logged.length).toBeGreaterThan(0);
  });

  it("mesmo arquivo duas vezes não duplica, nem pulando a prévia", async () => {
    const rows: Line[] = [{ line: 1 }, { line: 2, paidOn: "2026-04-10" }];
    await send(rows);
    expect(await statesOf(rows)).toEqual(["existe", "existe"]);
    expect(await send(rows)).toMatchObject({ ok: true, created: 0, skipped: 2 });
    expect(await stored()).toHaveLength(2);
  });

  it("períodos sobrepostos só gravam o que falta", async () => {
    await send([
      { line: 1, paidOn: "2026-01-15" },
      { line: 2, paidOn: "2026-02-15" },
    ]);
    const overlap: Line[] = [
      { line: 1, paidOn: "2026-02-15" },
      { line: 2, paidOn: "2026-03-16" },
    ];
    expect(await statesOf(overlap)).toEqual(["existe", "novo"]);
    expect(await send(overlap)).toMatchObject({ created: 1, skipped: 1 });
    expect(await stored()).toHaveLength(3);
  });

  it("dois envios ao mesmo tempo gravam uma vez só", async () => {
    const rows: Line[] = [{ line: 1 }, { line: 2, paidOn: "2026-04-10" }];
    const results = await Promise.all([send(rows), send(rows), send(rows)]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await stored()).toHaveLength(2);
  });

  it("linha em conferir só entra se a pessoa marcar", async () => {
    const rows: Line[] = [{ line: 1, kind: "jcp", net: "82.50" }];
    expect(await statesOf(rows)).toEqual(["conferir"]);
    expect(await send(rows, { selected: [] })).toMatchObject({ created: 0 });
    expect(await send(rows)).toMatchObject({ created: 1 });
    expect(await stored()).toMatchObject([{ gross: "82.50", withheld: "0.00" }]);
  });

  it("não confia no que vem do navegador", async () => {
    for (const bad of [
      { line: 1, ticker: "x'; drop table" },
      { line: 1, net: "-1.00" },
      { line: 1, net: "abc" },
      { line: 1, net: null },
      { line: 1, paidOn: "2026-13-40" },
      { line: 1, kind: "bonus" as never },
    ]) {
      await expect(send([bad])).resolves.toMatchObject({ ok: false });
    }
    await expect(send([{ line: 1 }, { line: 1 }])).resolves.toMatchObject({ ok: false });
    await expect(send([{ line: 1, paidOn: "2026-11-03" }])).resolves.toMatchObject({ created: 0 });
    expect(await stored()).toHaveLength(0);
  });

  it("descarta o que não é do formato, como nome e CPF enviados à força", async () => {
    const dirty = { ...line({ line: 1 }), nome: "Pessoa Ficticia", cpf: "000.000.000-00" };
    await commitDividendImport({ rows: [dirty], assignments: {}, selected: [1] });
    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("Pessoa");
  });
});

describe("ativo fora da carteira", () => {
  const rows: Line[] = [{ line: 1, ticker: "QWER4" }];

  it("não cria posição: sem escolher, nada grava", async () => {
    const before = await inA((tx) => tx.select().from(investments));
    const preview = await prepared(rows);
    expect(preview.rows[0]).toMatchObject({ state: "conferir", doubtReason: "sem_ativo" });
    expect(preview.options.map((option) => option.label)).toContain(`${ticker} · ABCD SA`);
    expect(await send(rows)).toMatchObject({ ok: true, created: 0, skipped: 1 });
    expect(await stored()).toHaveLength(0);
    expect(await inA((tx) => tx.select().from(investments))).toHaveLength(before.length);
  });

  it("escolhendo um investimento, entra nele", async () => {
    const assignments = { QWER4: semCodigo };
    expect(await send(rows, { assignments })).toMatchObject({ created: 1 });
    expect(await stored()).toMatchObject([{ investmentId: semCodigo }]);
  });

  it("investimento de outra família não é escolha válida", async () => {
    const [foreign] = await inB((tx) => tx.select().from(investments));
    const result = await send(rows, { assignments: { QWER4: foreign!.id } });
    expect(result).toMatchObject({ ok: true, created: 0 });
    expect(await stored()).toHaveLength(0);
    expect(await inB((tx) => tx.select().from(dividends))).toHaveLength(0);
  });
});

describe("quem pode", () => {
  it("visualizador não importa nem vê a prévia", async () => {
    ctx = viewer;
    expect(await prepareDividendImport(file([{ line: 1 }]))).toMatchObject({ ok: false });
    expect(await send([{ line: 1 }])).toMatchObject({ ok: false });
    ctx = owner;
    expect(await stored()).toHaveLength(0);
  });

  it("conta só leitura não importa", async () => {
    ctx = db.readOnlyContext(owner);
    expect(await send([{ line: 1 }])).toMatchObject({ ok: false });
    ctx = owner;
    expect(await stored()).toHaveLength(0);
  });

  it("outra família não enxerga nem confunde os proventos daqui", async () => {
    await send([{ line: 1 }]);
    ctx = other;
    expect((await prepared([{ line: 1 }])).rows[0]!.state).toBe("novo");
    expect(await send([{ line: 1 }])).toMatchObject({ created: 1 });
    ctx = owner;
    expect(await stored()).toHaveLength(1);
    expect(await inB((tx) => tx.select().from(dividends))).toHaveLength(1);
  });

  it("família fora do Brasil não usa a importação", async () => {
    const setCurrency = (mainCurrency: "BRL" | "USD") =>
      inB((tx) => tx.update(householdSettings).set({ mainCurrency }));
    await setCurrency("USD");
    ctx = other;
    const preview = await prepareDividendImport(file([{ line: 1 }]));
    const commit = await send([{ line: 1 }]);
    await setCurrency("BRL");
    expect(preview).toMatchObject({ ok: false });
    expect(commit).toMatchObject({ ok: false });
    expect(await inB((tx) => tx.select().from(dividends))).toHaveLength(0);
  });

  it("a linha importada aparece só na família dela", async () => {
    await send([{ line: 1 }]);
    const mine = await stored();
    expect(mine[0]!.householdId).toBe(A.household);
    expect(await inB((tx) => tx.select().from(dividends))).toHaveLength(0);
  });
});
