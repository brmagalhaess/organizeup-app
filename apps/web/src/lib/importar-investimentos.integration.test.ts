// Importar a carteira (ADR-0024), pelas server actions de verdade, contra um Postgres real com RLS.
// Prova o que o plano puro não prova sozinho: uma transação só, confirmação que reconfere, papel de
// visualizador e isolamento entre famílias. Sem tabela nova: `investment_trades` já tem caso no teste de RLS.
// Dados fictícios.
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { TenantContext } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.worker;
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
const { commitInvestmentImport, prepareInvestmentImport } =
  await import("@/app/app/(painel)/investimentos/importar/actions");
const { loadPortfolio } = await import("@/lib/investments");

const { accounts, auditLog, eq, household, householdMember, householdSettings } = db;
const { investments, investmentTrades, transactions, user } = db;

const A = { household: "hh-imp-a", owner: "user-imp-a", viewer: "user-imp-v" };
const B = { household: "hh-imp-b", owner: "user-imp-b" };

const inA = <T>(fn: Parameters<typeof db.withWorkerHousehold<T>>[1]) =>
  db.withWorkerHousehold(A.household, fn);
const inB = <T>(fn: Parameters<typeof db.withWorkerHousehold<T>>[1]) =>
  db.withWorkerHousehold(B.household, fn);

let owner: TenantContext;
let viewer: TenantContext;
let other: TenantContext;
let bank = "";
let dollars = "";

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
  ticker?: string | null;
  title?: string | null;
  side?: "compra" | "venda";
  date?: string;
  quantity?: string;
  unitPrice?: string;
  fees?: string;
  doubt?: "nota_nao_fecha" | null;
}

const line = (row: Line) => ({
  ticker: "ABCD3",
  title: null,
  side: "compra" as const,
  date: "2026-03-05",
  quantity: "100",
  unitPrice: "10",
  fees: "0.00",
  doubt: null,
  ...row,
});

const file = (trades: Line[]) => ({
  trades: trades.map(line),
  positions: [],
  tickers: {},
});

const send = (trades: Line[], over: Record<string, unknown> = {}) =>
  commitInvestmentImport({
    ...file(trades),
    accountId: "",
    selected: trades.map((row) => row.line),
    classes: { ABCD3: "acao", ABCD4: "acao", WXYZ11: "fii" },
    prices: {},
    positionDate: null,
    ...over,
  });

const prepared = async (trades: Line[]) => {
  const result = await prepareInvestmentImport(file(trades));
  if (!result.ok) throw new Error(result.message);
  return result;
};

const stateOf = async (trades: Line[]) => (await prepared(trades)).rows.map((row) => row.state);

const trades = () => inA((tx) => tx.select().from(investmentTrades));
const holdings = () => inA((tx) => tx.select().from(investments));
const entries = () => inA((tx) => tx.select().from(transactions));

const clear = async () => {
  await inA(async (tx) => {
    await tx.delete(investments);
    await tx.delete(transactions);
  });
  await inB((tx) => tx.delete(investments));
};

beforeAll(async () => {
  await db.withAdmin("seed do teste de importação", async (admin) => {
    await admin.insert(user).values([
      { id: A.owner, name: "Dona", email: "dona-imp@example.com" },
      { id: A.viewer, name: "Leitora", email: "leitora-imp@example.com" },
      { id: B.owner, name: "Vizinha", email: "vizinha-imp@example.com" },
    ]);
    await admin.insert(household).values([
      { id: A.household, name: "Imp A", slug: A.household },
      { id: B.household, name: "Imp B", slug: B.household },
    ]);
    await admin.insert(householdMember).values([
      { id: "m-a", organizationId: A.household, userId: A.owner, role: "owner" },
      { id: "m-v", organizationId: A.household, userId: A.viewer, role: "viewer" },
      { id: "m-b", organizationId: B.household, userId: B.owner, role: "owner" },
    ]);
  });
  owner = await session(A.owner, A.household);
  viewer = await session(A.viewer, A.household);
  other = await session(B.owner, B.household);
  await inA(async (tx) => {
    await tx.insert(householdSettings).values({ householdId: A.household });
    const rows = await tx
      .insert(accounts)
      .values([
        { householdId: A.household, name: "Banco", openingBalance: "1000.00" },
        { householdId: A.household, name: "Dólar", currency: "USD" },
      ])
      .returning({ id: accounts.id, name: accounts.name });
    bank = rows.find((row) => row.name === "Banco")!.id;
    dollars = rows.find((row) => row.name === "Dólar")!.id;
  });
  await inB((tx) => tx.insert(householdSettings).values({ householdId: B.household }));
  await db.saveMarketAssets([
    { ticker: "ABCD3", name: "ABCD SA ON NM", assetClass: "acao", sector: null, close: "12" },
    { ticker: "ABCD4", name: "ABCD SA PN N2", assetClass: "acao", sector: null, close: null },
  ]);
});

beforeEach(async () => {
  ctx = owner;
  await clear();
});

afterAll(() => db.closeAllPools());

describe("confirmar", () => {
  it("cria o ativo pelo catálogo, soma as taxas ao custo e não mexe em conta", async () => {
    expect(await send([{ line: 1, fees: "0.30" }])).toMatchObject({
      ok: true,
      created: 1,
      assets: 1,
    });
    const [asset] = await holdings();
    expect(asset).toMatchObject({
      name: "ABCD SA ON NM",
      ticker: "ABCD3",
      assetClass: "acao",
      priceSource: "mercado",
    });
    expect(asset!.currentPrice).toBe("12.00000000");
    expect(await entries()).toHaveLength(0);
    const data = await loadPortfolio(owner);
    expect(data.rows[0]!.position).toMatchObject({ cost: "1000.30", quantity: "100" });
    const logged = await inA((tx) =>
      tx.select().from(auditLog).where(eq(auditLog.entity, "investment_trades")),
    );
    expect(logged.length).toBeGreaterThan(0);
  });

  it("enviar o mesmo arquivo de novo não duplica, nem pulando a prévia", async () => {
    const lines: Line[] = [
      { line: 1 },
      { line: 2, date: "2026-03-06", unitPrice: "11" },
      { line: 3, date: "2026-03-09", side: "venda", quantity: "50", unitPrice: "12" },
    ];
    await send(lines);
    expect(await stateOf(lines)).toEqual(["existe", "existe", "existe"]);
    const again = await send(lines);
    expect(again).toMatchObject({ ok: true, created: 0, skipped: 3 });
    expect(await trades()).toHaveLength(3);
  });

  it("sobreposição parcial de períodos só grava o que falta", async () => {
    await send([
      { line: 1, date: "2026-01-05" },
      { line: 2, date: "2026-02-03" },
    ]);
    const overlap: Line[] = [
      { line: 1, date: "2026-02-03" },
      { line: 2, date: "2026-03-02" },
    ];
    expect(await stateOf(overlap)).toEqual(["existe", "novo"]);
    expect(await send(overlap)).toMatchObject({ created: 1, skipped: 1 });
    expect(await trades()).toHaveLength(3);
  });

  it("nota depois da Negociação traz as taxas para a mesma operação", async () => {
    await send([{ line: 1 }]);
    const nota: Line[] = [{ line: 9, ticker: null, title: "ABCD SA ON NM", fees: "0.30" }];
    expect((await prepared(nota)).rows[0]).toMatchObject({ ticker: "ABCD3", state: "taxas" });
    expect(await send(nota)).toMatchObject({ created: 0, feesUpdated: 1 });
    const rows = await trades();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fees).toBe("0.30");
    expect(await stateOf(nota)).toEqual(["existe"]);
  });

  it("dois envios ao mesmo tempo gravam uma vez só", async () => {
    const lines: Line[] = [{ line: 1 }, { line: 2, date: "2026-03-06" }];
    const results = await Promise.all([send(lines), send(lines), send(lines)]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await trades()).toHaveLength(2);
    expect(await holdings()).toHaveLength(1);
  });

  it("linha em dúvida só entra se a pessoa marcar", async () => {
    const lines: Line[] = [{ line: 1, doubt: "nota_nao_fecha" }];
    expect(await stateOf(lines)).toEqual(["conferir"]);
    expect(await send(lines, { selected: [] })).toMatchObject({ created: 0 });
    expect(await trades()).toHaveLength(0);
    expect(await send(lines)).toMatchObject({ created: 1 });
  });

  it("com conta escolhida, cria o lançamento da operação", async () => {
    await send([{ line: 1, fees: "0.30" }], { accountId: bank });
    const rows = await entries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "despesa", amount: "1000.30" });
    expect((await trades())[0]!.transactionId).toBe(rows[0]!.id);
  });

  it("falhou no meio, não fica pela metade", async () => {
    const lines: Line[] = [{ line: 1 }, { line: 2, ticker: "ABCD4", date: "2026-03-06" }];
    // Conta em dólar sem cotação: a segunda etapa de cada linha falha depois de criar o ativo.
    const result = await send(lines, { accountId: dollars });
    expect(result.ok ? "" : result.message).toContain("cotação");
    expect(await holdings()).toHaveLength(0);
    expect(await trades()).toHaveLength(0);
    expect(await entries()).toHaveLength(0);
  });

  it("recusa inteira a venda maior que a posição", async () => {
    const lines: Line[] = [
      { line: 1 },
      { line: 2, side: "venda", date: "2026-03-06", quantity: "150" },
    ];
    const result = await send(lines);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.message).toContain("ABCD3");
    expect(await trades()).toHaveLength(0);
    expect(await holdings()).toHaveLength(0);
  });

  it("ativo fora do catálogo exige o tipo", async () => {
    const lines: Line[] = [{ line: 1, ticker: "QWER11" }];
    expect((await prepared(lines)).assets[0]).toMatchObject({ assetClass: null, inCatalog: false });
    expect(await send(lines, { classes: {} })).toMatchObject({ ok: false });
    expect(await holdings()).toHaveLength(0);
    expect(await send(lines, { classes: { QWER11: "etf_bdr" } })).toMatchObject({ ok: true });
    expect((await holdings())[0]).toMatchObject({ ticker: "QWER11", assetClass: "etf_bdr" });
  });

  it("não confia no que vem do navegador", async () => {
    await expect(send([{ line: 1, quantity: "-1" }])).resolves.toMatchObject({ ok: false });
    await expect(send([{ line: 1, quantity: "abc" }])).resolves.toMatchObject({ ok: false });
    await expect(send([{ line: 1, unitPrice: "abc" }])).resolves.toMatchObject({ ok: false });
    await expect(send([{ line: 1, quantity: "0.00" }])).resolves.toMatchObject({ ok: false });
    await expect(send([{ line: 1, ticker: "x'; drop table" }])).resolves.toMatchObject({
      ok: false,
    });
    await expect(send([{ line: 1, fees: "abc" }])).resolves.toMatchObject({ ok: false });
    await expect(send([{ line: 1, date: "2999-01-01" }])).resolves.toMatchObject({ ok: false });
    await expect(
      send([{ line: 1 }], { accountId: "conta-de-outra-familia" }),
    ).resolves.toMatchObject({ ok: false });
    expect(await trades()).toHaveLength(0);
  });
});

describe("Posição", () => {
  const position = {
    line: 2,
    ticker: "ABCD3",
    name: "ABCD SA",
    quantity: "150",
    closePrice: "12",
  };
  const positionFile = { trades: [], positions: [position], tickers: {} };

  it("não grava sem o preço pago, e com ele a linha passa a conferir", async () => {
    await send([{ line: 1 }]);
    const preview = await prepareInvestmentImport(positionFile);
    expect(preview).toMatchObject({ ok: true, positions: [{ state: "falta", difference: "50" }] });
    const commit = (prices: Record<string, string>) =>
      commitInvestmentImport({
        ...positionFile,
        accountId: "",
        selected: [],
        classes: {},
        prices,
        positionDate: "2026-03-20",
      });
    expect(await commit({})).toMatchObject({ created: 0 });
    expect(await commit({ "2": "preço" })).toMatchObject({ ok: false });
    expect(await commit({ "2": "9,50" })).toMatchObject({ created: 1 });
    const rows = await trades();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.occurredOn === "2026-03-20")).toMatchObject({
      quantity: "50.00000000",
      unitPrice: "9.50000000",
    });
    const after = await prepareInvestmentImport(positionFile);
    expect(after).toMatchObject({ positions: [{ state: "confere" }] });
    expect(await commit({ "2": "9,50" })).toMatchObject({ created: 0 });
  });
});

describe("quem pode", () => {
  it("visualizador não importa nem vê a prévia", async () => {
    ctx = viewer;
    expect(await prepareInvestmentImport(file([{ line: 1 }]))).toMatchObject({ ok: false });
    expect(await send([{ line: 1 }])).toMatchObject({ ok: false });
    ctx = owner;
    expect(await trades()).toHaveLength(0);
  });

  it("conta só leitura não importa", async () => {
    ctx = db.readOnlyContext(owner);
    expect(await send([{ line: 1 }])).toMatchObject({ ok: false });
    ctx = owner;
    expect(await holdings()).toHaveLength(0);
  });

  it("outra família não enxerga nem completa a operação daqui", async () => {
    await send([{ line: 1 }]);
    const lines: Line[] = [{ line: 5, fees: "0.30" }];
    ctx = other;
    const seen = await prepared(lines);
    expect(seen.rows[0]!.state).toBe("novo");
    expect(seen.assets).toHaveLength(1);
    expect(await send(lines)).toMatchObject({ ok: true, created: 1, feesUpdated: 0 });
    ctx = owner;
    const mine = await trades();
    expect(mine).toHaveLength(1);
    expect(mine[0]!.fees).toBe("0.00");
    expect(await inB((tx) => tx.select().from(investmentTrades))).toHaveLength(1);
  });

  it("família fora do Brasil não usa a importação da B3", async () => {
    const setCurrency = (mainCurrency: "BRL" | "USD") =>
      inB((tx) => tx.update(householdSettings).set({ mainCurrency }));
    await setCurrency("USD");
    ctx = other;
    const preview = await prepareInvestmentImport(file([{ line: 1 }]));
    const commit = await send([{ line: 1 }]);
    await setCurrency("BRL");
    expect(preview).toMatchObject({ ok: false });
    expect(commit).toMatchObject({ ok: false });
    expect(await inB((tx) => tx.select().from(investments))).toHaveLength(0);
  });
});
