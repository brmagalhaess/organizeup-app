// Conexão com bancos pela Pluggy (ADR-0038), contra um Postgres real com RLS. A Pluggy é simulada por um
// `fetch` de mentira, com respostas no formato da API pública. Tudo fictício.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { TenantContext } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.worker;
process.env.ADMIN_DATABASE_URL = urls.admin;
process.env.DOCUMENT_ENCRYPTION_KEY = randomBytes(32).toString("base64");

let ctx: TenantContext;
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { default: messages } = await import("../../messages/pt-BR.json");
  return {
    getLocale: async () => "pt-BR",
    getTranslations: async (namespace: never) =>
      createTranslator({ locale: "pt-BR", messages, namespace }),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({
  requireTenant: async () => ({ ctx }),
  platformFlags: async () => ({ bankFeedEnabled: true }),
  isServiceAdmin: () => false,
}));

const db = await import("@organizeup/db");
const feed = await import("@/lib/bank-feed");
const { commitImport, prepareImport } = await import("@/app/app/(painel)/importar/actions");

const { accounts, bankConnectionAccounts, bankConnections, categories, eq, transactions } = db;
const { household, householdMember, householdSettings, people, user } = db;

const H = { household: "hh-pluggy", owner: "user-pluggy", partner: "user-pluggy-2" };
const inH = <T>(fn: Parameters<typeof db.withWorkerHousehold<T>>[1]) =>
  db.withWorkerHousehold(H.household, fn);

const CLIENT_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CLIENT_SECRET = "0f9e8d7c-6b5a-4c3d-9e2f-1a0b9c8d7e6f";
const ITEM = "11111111-2222-4333-8444-555555555555";
// A outra pessoa tem a própria conta na Pluggy, com outra chave e outra conexão.
const SPOUSE_ID = "2a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const SPOUSE_SECRET = "1f9e8d7c-6b5a-4c3d-9e2f-1a0b9c8d7e6f";
const SPOUSE_ITEM = "22222222-2222-4333-8444-555555555555";

// O que a Pluggy de mentira devolve; os testes trocam para simular mudanças.
const remote = {
  accounts: [
    {
      id: "acc-corrente",
      type: "BANK",
      subtype: "CHECKING_ACCOUNT",
      name: "Conta",
      number: "00012345-6",
      currencyCode: "BRL",
    },
    {
      id: "acc-dolar",
      type: "BANK",
      subtype: "CHECKING_ACCOUNT",
      name: "Global",
      number: "777",
      currencyCode: "USD",
    },
    {
      id: "acc-cartao",
      type: "CREDIT",
      subtype: "CREDIT_CARD",
      name: "Cartão",
      number: "4321",
      currencyCode: "BRL",
    },
  ] as Array<Record<string, unknown>>,
  transactions: [
    {
      id: "t1",
      date: "2026-11-03T00:00:00.000Z",
      description: "MERCADO CENTRAL",
      type: "DEBIT",
      amount: -84.9,
      status: "POSTED",
    },
    {
      id: "t2",
      date: "2026-11-05T15:00:00.000Z",
      description: "PIX RECEBIDO",
      type: "CREDIT",
      amount: 1500,
      status: "POSTED",
    },
    {
      id: "t3",
      date: "2026-11-06T00:00:00.000Z",
      description: "PADARIA",
      type: "DEBIT",
      amount: -12.5,
      status: "PENDING",
    },
  ] as Array<Record<string, unknown>>,
  investments: [
    {
      id: "i1",
      code: "PETR4",
      name: "PETROBRAS PN",
      type: "EQUITY",
      quantity: 100,
      value: 38.5,
      amount: 3850,
      amountOriginal: 3000,
      status: "ACTIVE",
    },
    {
      id: "i2",
      code: null,
      name: "CDB Banco X",
      type: "FIXED_INCOME",
      quantity: 1,
      amount: 5000,
      status: "ACTIVE",
    },
  ] as Array<Record<string, unknown>>,
};
// O que a chave da outra pessoa enxerga.
const spouseRemote = {
  accounts: [
    {
      id: "acc-dela",
      type: "BANK",
      subtype: "CHECKING_ACCOUNT",
      name: "Conta dela",
      number: "9876",
      currencyCode: "BRL",
    },
  ],
  transactions: [
    {
      id: "s1",
      date: "2026-11-04T00:00:00.000Z",
      description: "FARMACIA",
      type: "DEBIT",
      amount: -40,
      status: "POSTED",
    },
  ],
  investments: [
    {
      id: "j1",
      code: "PETR4",
      name: "PETROBRAS PN",
      type: "EQUITY",
      quantity: 50,
      value: 38.5,
      amount: 1925,
      amountOriginal: 1800,
      status: "ACTIVE",
    },
  ],
};
const calls: string[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(String(input));
  calls.push(`${init.method ?? "GET"} ${url.pathname}`);
  if (url.pathname === "/auth") {
    const body = JSON.parse(String(init.body)) as { clientId: string; clientSecret: string };
    if (body.clientId === CLIENT_ID && body.clientSecret === CLIENT_SECRET) {
      return json({ apiKey: "sessao" });
    }
    if (body.clientId === SPOUSE_ID && body.clientSecret === SPOUSE_SECRET) {
      return json({ apiKey: "sessao-dela" });
    }
    return json({ message: "recusado" }, 401);
  }
  // Cada chave só enxerga as próprias conexões, como na Pluggy.
  const key = new Headers(init.headers).get("X-API-KEY");
  const mine = key === "sessao";
  if (!mine && key !== "sessao-dela") return json({}, 401);
  const item = mine ? ITEM : SPOUSE_ITEM;
  if (url.pathname === "/accounts") {
    return url.searchParams.get("itemId") === item
      ? json({ results: mine ? remote.accounts : spouseRemote.accounts })
      : json({ message: "não achado" }, 404);
  }
  if (url.pathname === "/v2/transactions") {
    const account = url.searchParams.get("accountId");
    if (mine && account === "acc-corrente")
      return json({ results: remote.transactions, next: null });
    if (!mine && account === "acc-dela")
      return json({ results: spouseRemote.transactions, next: null });
    return json({}, 404);
  }
  if (url.pathname === "/investments") {
    return url.searchParams.get("itemId") === item
      ? json({ results: mine ? remote.investments : spouseRemote.investments, totalPages: 1 })
      : json({}, 404);
  }
  return json({}, 404);
}) as typeof fetch;
const options = { fetcher };

let real = "";
let dollars = "";
let hers = "";
let expense = "";
let income = "";
let me = "";
let spouse = "";
let child = "";
let partner: TenantContext;

const links = () => inH((tx) => tx.select().from(bankConnectionAccounts));
const linkOf = async (externalId: string) =>
  (await links()).find((row) => row.externalId === externalId)!;
const connections = () => inH((tx) => tx.select().from(bankConnections));
const mineOf = async (personId: string) =>
  (await connections()).find((row) => row.personId === personId)!;

const keys = (over: Partial<Parameters<typeof feed.connectBank>[1]> = {}) => ({
  connectionId: null,
  personId: me,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  itemIds: ITEM,
  consent: false,
  ...over,
});
const spouseKeys = (over: Partial<Parameters<typeof feed.connectBank>[1]> = {}) =>
  keys({
    personId: spouse,
    clientId: SPOUSE_ID,
    clientSecret: SPOUSE_SECRET,
    itemIds: SPOUSE_ITEM,
    consent: true,
    ...over,
  });

const importAll = async (accountId: string, rows: Parameters<typeof prepareImport>[0]["rows"]) => {
  const prepared = await prepareImport({ accountId, source: "ofx", rows });
  if (!prepared.ok) throw new Error(prepared.message);
  const fresh = prepared.rows.filter((row) => row.state === "novo");
  const committed =
    fresh.length === 0
      ? { ok: true as const, imported: 0 }
      : await commitImport({
          accountId,
          source: "ofx",
          rows: fresh.map((row) => ({
            date: row.date,
            description: row.description,
            amount: row.amount,
            kind: row.kind,
            fingerprint: row.fingerprint,
            categoryId: row.kind === "despesa" ? expense : income,
            newCategory: null,
            source: row.source,
            corrected: true,
            matchKey: null,
            matchMonth: null,
          })),
        });
  return { prepared: prepared.rows, committed };
};

beforeAll(async () => {
  await db.withAdmin("seed do teste da conexão", async (admin) => {
    await admin.insert(user).values([
      { id: H.owner, name: "Titular", email: "titular-pluggy@example.com" },
      { id: H.partner, name: "Outra pessoa", email: "outra-pluggy@example.com" },
    ]);
    await admin.insert(household).values({ id: H.household, name: "Conexão", slug: "hh-pluggy" });
    await admin.insert(householdMember).values([
      { id: "m-pluggy-1", organizationId: H.household, userId: H.owner, role: "owner" },
      { id: "m-pluggy-2", organizationId: H.household, userId: H.partner, role: "adult" },
    ]);
  });
  const session = async (id: string) => {
    const made = await db.fromSession({
      user: { id },
      session: { activeOrganizationId: H.household },
    });
    if (!made) throw new Error("sem contexto");
    return made;
  };
  ctx = await session(H.owner);
  partner = await session(H.partner);
  await inH(async (tx) => {
    await tx.insert(householdSettings).values({ householdId: H.household });
    const persons = await tx
      .insert(people)
      .values([
        { householdId: H.household, name: "Ana", relation: "titular", userId: H.owner },
        { householdId: H.household, name: "Bia", relation: "conjuge" },
        { householdId: H.household, name: "Caio", relation: "filho", birthYear: 2015 },
        { householdId: H.household, name: "Dora", relation: "pai_mae" },
      ])
      .returning({ id: people.id, name: people.name });
    me = persons.find((row) => row.name === "Ana")!.id;
    spouse = persons.find((row) => row.name === "Bia")!.id;
    child = persons.find((row) => row.name === "Caio")!.id;
    const rows = await tx
      .insert(accounts)
      .values([
        { householdId: H.household, name: "Banco" },
        { householdId: H.household, name: "Dólar", currency: "USD" },
        { householdId: H.household, name: "Banco dela" },
      ])
      .returning({ id: accounts.id, name: accounts.name });
    real = rows.find((row) => row.name === "Banco")!.id;
    dollars = rows.find((row) => row.name === "Dólar")!.id;
    hers = rows.find((row) => row.name === "Banco dela")!.id;
    const cats = await tx
      .insert(categories)
      .values([
        { householdId: H.household, name: "Mercado", kind: "despesa" },
        { householdId: H.household, name: "Salário", kind: "receita" },
      ])
      .returning({ id: categories.id, kind: categories.kind });
    expense = cats.find((row) => row.kind === "despesa")!.id;
    income = cats.find((row) => row.kind === "receita")!.id;
  });
});

afterAll(() => db.closeAllPools());

describe("conexão pela Pluggy com a chave da pessoa", () => {
  it("recusa campos fora do formato sem chamar a Pluggy", async () => {
    calls.length = 0;
    const bad = [
      keys({ clientId: "meu-id" }),
      keys({ clientSecret: "curto" }),
      keys({ itemIds: "não é um identificador" }),
      keys({ clientId: "", clientSecret: "" }),
    ];
    for (const input of bad) {
      expect(await feed.connectBank(ctx, input, options)).toEqual({
        ok: false,
        code: "dados_invalidos",
      });
    }
    expect(calls).toEqual([]);
  });

  it("só aceita chave de pessoa adulta do cadastro, e a de outra pessoa com autorização", async () => {
    calls.length = 0;
    const refused = async (input: ReturnType<typeof keys>) => {
      const result = await feed.connectBank(ctx, input, options);
      return result.ok ? "ok" : result.code;
    };
    expect(await refused(keys({ personId: "ninguém" }))).toBe("pessoa_invalida");
    expect(await refused(keys({ personId: child }))).toBe("pessoa_invalida");
    expect(await refused(spouseKeys({ consent: false }))).toBe("sem_consentimento");
    expect(calls).toEqual([]);
    expect((await feed.loadBankPeople(ctx)).map((person) => [person.name, person.self])).toEqual([
      ["Ana", true],
      ["Bia", false],
      ["Dora", false],
    ]);
  });

  it("não guarda nada quando a Pluggy recusa a chave ou a conexão", async () => {
    expect(
      await feed.connectBank(ctx, keys({ clientSecret: `${CLIENT_SECRET}x` }), options),
    ).toEqual({
      ok: false,
      code: "credenciais",
    });
    expect(await feed.connectBank(ctx, keys({ itemIds: SPOUSE_ITEM }), options)).toEqual({
      ok: false,
      code: "conexao",
    });
    expect(await connections()).toEqual([]);
  });

  it("guarda as chaves cifradas e lista as contas da conexão", async () => {
    const result = await feed.connectBank(
      ctx,
      keys({ clientId: CLIENT_ID.toUpperCase(), itemIds: ` ${ITEM} ` }),
      options,
    );
    expect(result).toEqual({ ok: true, accounts: 3 });
    const [stored] = await connections();
    expect(stored!.userId).toBe(H.owner);
    expect(stored!.personId).toBe(me);
    expect(stored!.itemIds).toEqual([ITEM]);
    const dump = JSON.stringify(stored);
    expect(dump).not.toContain(CLIENT_ID);
    expect(dump).not.toContain(CLIENT_SECRET);

    const [view] = await feed.loadBankConnections(ctx);
    expect(view!.personName).toBe("Ana");
    expect(view!.itemIds).toEqual([ITEM]);
    expect(
      view!.links.map((link) => [link.name, link.kind, link.numberTail, link.accountId]),
    ).toEqual([
      ["Cartão", "cartao", "4321", null],
      ["Conta", "corrente", "3456", null],
      ["Global", "corrente", null, null],
    ]);
  });

  it("outro login da mesma família não vê nem usa a conexão", async () => {
    const link = await linkOf("acc-corrente");
    const mine = await mineOf(me);
    expect(await feed.loadBankConnections(partner)).toEqual([]);
    expect(await feed.linkBankAccount(partner, link.id, real)).toEqual({
      ok: false,
      code: "sem_conexao",
    });
    expect(await feed.bankStatement(partner, link.id, null, options)).toEqual({
      ok: false,
      code: "sem_conexao",
    });
    expect(await feed.bankPortfolio(partner, options)).toEqual({ ok: false, code: "sem_conexao" });
    expect(await feed.refreshBank(partner, mine.id, options)).toEqual({
      ok: false,
      code: "sem_conexao",
    });
    expect(await feed.removeBank(partner, mine.id)).toEqual({ ok: false, code: "sem_conexao" });
    // Nem guarda outra chave para a mesma pessoa: a conta chegaria por dois caminhos.
    expect(await feed.connectBank(partner, keys({ consent: true }), options)).toEqual({
      ok: false,
      code: "pessoa_ja_conectada",
    });
    expect(await feed.loadBankConnections(ctx)).toHaveLength(1);
  });

  it("quem só lê não conecta", async () => {
    const viewer = db.readOnlyContext(ctx);
    expect(await feed.connectBank(viewer, spouseKeys(), options)).toEqual({
      ok: false,
      code: "sem_permissao",
    });
  });

  it("liga a conta do banco só a conta ativa da mesma moeda, e nunca cartão", async () => {
    const [checking, global, card] = await Promise.all(
      ["acc-corrente", "acc-dolar", "acc-cartao"].map(linkOf),
    );
    expect(await feed.linkBankAccount(ctx, card!.id, real)).toEqual({ ok: false, code: "cartao" });
    expect(await feed.linkBankAccount(ctx, checking!.id, dollars)).toEqual({
      ok: false,
      code: "conta_invalida",
    });
    expect(await feed.linkBankAccount(ctx, checking!.id, "conta-de-outra-familia")).toEqual({
      ok: false,
      code: "conta_invalida",
    });
    expect(await feed.bankStatement(ctx, checking!.id, null, options)).toEqual({
      ok: false,
      code: "conta_invalida",
    });
    expect(await feed.linkBankAccount(ctx, checking!.id, real)).toEqual({ ok: true });
    expect(await feed.linkBankAccount(ctx, global!.id, dollars)).toEqual({ ok: true });
    expect((await linkOf("acc-corrente")).accountId).toBe(real);
  });

  it("traz os lançamentos para a conferência e não duplica na segunda busca", async () => {
    const link = await linkOf("acc-corrente");
    const fetched = await feed.bankStatement(ctx, link.id, "2026-11-01", options);
    if (!fetched.ok) throw new Error(fetched.code);
    expect(fetched.accountId).toBe(real);
    expect(fetched.from).toBe("2026-11-01");
    expect(fetched.pending).toBe(1);
    expect(fetched.rows).toEqual([
      {
        date: "2026-11-03",
        description: "MERCADO CENTRAL",
        amount: "84.90",
        kind: "despesa",
        externalId: "pluggy:t1",
      },
      {
        date: "2026-11-05",
        description: "PIX RECEBIDO",
        amount: "1500.00",
        kind: "receita",
        externalId: "pluggy:t2",
      },
    ]);
    // Buscar não grava: só a conferência grava.
    expect(await inH((tx) => tx.select().from(transactions))).toEqual([]);

    const first = await importAll(real, fetched.rows);
    expect(first.prepared.map((row) => row.state)).toEqual(["novo", "novo"]);
    expect(first.committed).toMatchObject({ ok: true, imported: 2 });
    await feed.markBankSynced(ctx, link.id, fetched.to);
    expect((await linkOf("acc-corrente")).syncedOn).toBe(fetched.to);

    // O pendente foi lançado no banco, e o resto volta igual.
    remote.transactions[2]!.status = "POSTED";
    const again = await feed.bankStatement(ctx, link.id, "2026-11-01", options);
    if (!again.ok) throw new Error(again.code);
    const second = await prepareImport({ accountId: real, source: "ofx", rows: again.rows });
    if (!second.ok) throw new Error(second.message);
    expect(second.rows.map((row) => [row.description, row.state])).toEqual([
      ["MERCADO CENTRAL", "importado"],
      ["PIX RECEBIDO", "importado"],
      ["PADARIA", "novo"],
    ]);
    expect(await inH((tx) => tx.select().from(transactions))).toHaveLength(2);
  });

  it("guarda a segunda chave, da outra pessoa, sem misturar com a primeira", async () => {
    expect(await feed.connectBank(ctx, spouseKeys(), options)).toEqual({ ok: true, accounts: 1 });
    const views = await feed.loadBankConnections(ctx);
    expect(views.map((view) => [view.personName, view.links.length])).toEqual([
      ["Ana", 3],
      ["Bia", 1],
    ]);
    // As chaves de uma linha não abrem na outra.
    const [first, second] = await connections();
    await inH((tx) =>
      tx
        .update(bankConnections)
        .set({
          clientIdSealed: first!.clientIdSealed,
          clientSecretSealed: first!.clientSecretSealed,
        })
        .where(eq(bankConnections.id, second!.id)),
    );
    expect(await feed.refreshBank(ctx, second!.id, options)).toEqual({ ok: false, code: "cofre" });
    await inH((tx) =>
      tx
        .update(bankConnections)
        .set({
          clientIdSealed: second!.clientIdSealed,
          clientSecretSealed: second!.clientSecretSealed,
        })
        .where(eq(bankConnections.id, second!.id)),
    );
    expect(await feed.refreshBank(ctx, second!.id, options)).toEqual({ ok: true, accounts: 1 });
  });

  it("não cabe uma terceira chave no mesmo login", async () => {
    const [dora] = await inH((tx) => tx.select().from(people).where(eq(people.name, "Dora")));
    expect(await feed.connectBank(ctx, spouseKeys({ personId: dora!.id }), options)).toEqual({
      ok: false,
      code: "limite_de_chaves",
    });
  });

  it("duas contas do banco não entram na mesma conta daqui, e cada uma traz só o seu", async () => {
    const her = await linkOf("acc-dela");
    expect(await feed.linkBankAccount(ctx, her.id, real)).toEqual({
      ok: false,
      code: "conta_em_uso",
    });
    expect(await feed.linkBankAccount(ctx, her.id, hers)).toEqual({ ok: true });
    const fetched = await feed.bankStatement(ctx, her.id, "2026-11-01", options);
    if (!fetched.ok) throw new Error(fetched.code);
    expect(fetched.accountId).toBe(hers);
    expect(fetched.rows.map((row) => row.externalId)).toEqual(["pluggy:s1"]);
    const imported = await importAll(hers, fetched.rows);
    expect(imported.committed).toMatchObject({ ok: true, imported: 1 });
    const rows = await inH((tx) => tx.select().from(transactions));
    expect(rows.filter((row) => row.accountId === real)).toHaveLength(2);
    expect(rows.filter((row) => row.accountId === hers).map((row) => row.description)).toEqual([
      "FARMACIA",
    ]);
  });

  it("soma a posição em bolsa das duas chaves e avisa do que não entra", async () => {
    const result = await feed.bankPortfolio(ctx, options);
    if (!result.ok) throw new Error(result.code);
    expect(result.file.positions).toEqual([
      { line: 0, ticker: "PETR4", name: "PETROBRAS PN", quantity: "150", closePrice: "38.5" },
    ]);
    expect(result.paid).toEqual({ "0": "32" });
    expect(result.file.ignored).toEqual([
      { line: 1, label: "CDB Banco X", date: null, reason: "ativo_nao_listado" },
    ]);
  });

  it("atualizar mantém a ligação e tira a conta que saiu da Pluggy", async () => {
    remote.accounts = remote.accounts.filter((account) => account.id !== "acc-dolar");
    remote.accounts[0]!.name = "Conta Nova";
    const mine = await mineOf(me);
    expect(await feed.refreshBank(ctx, mine.id, options)).toEqual({ ok: true, accounts: 2 });
    const rows = (await links()).filter((row) => row.connectionId === mine.id);
    expect(rows.map((row) => row.externalId).sort()).toEqual(["acc-cartao", "acc-corrente"]);
    const checking = rows.find((row) => row.externalId === "acc-corrente")!;
    expect(checking.name).toBe("Conta Nova");
    expect(checking.accountId).toBe(real);
    expect(checking.syncedOn).not.toBeNull();
    // A conta da outra chave não foi tocada.
    expect((await linkOf("acc-dela")).accountId).toBe(hers);
  });

  it("apagar a conta do OrganizeUp só desfaz a ligação", async () => {
    const [temp] = await inH((tx) =>
      tx.insert(accounts).values({ householdId: H.household, name: "Temporária" }).returning(),
    );
    const card = await linkOf("acc-cartao");
    await inH((tx) =>
      tx
        .update(bankConnectionAccounts)
        .set({ accountId: temp!.id })
        .where(eq(bankConnectionAccounts.id, card.id)),
    );
    await inH((tx) => tx.delete(accounts).where(eq(accounts.id, temp!.id)));
    expect((await linkOf("acc-cartao")).accountId).toBeNull();
  });

  it("com a chave do cofre trocada, pede as chaves de novo em vez de falhar", async () => {
    const before = process.env.DOCUMENT_ENCRYPTION_KEY;
    process.env.DOCUMENT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    try {
      expect(await feed.bankPortfolio(ctx, options)).toEqual({ ok: false, code: "cofre" });
    } finally {
      process.env.DOCUMENT_ENCRYPTION_KEY = before;
    }
  });

  it("falha da Pluggy fica anotada só pelo código, na chave que falhou", async () => {
    const link = await linkOf("acc-corrente");
    const failing = (async (input: RequestInfo | URL, init: RequestInit = {}) =>
      new URL(String(input)).pathname === "/v2/transactions"
        ? json({ message: "detalhe do banco" }, 429)
        : fetcher(input, init)) as typeof fetch;
    expect(await feed.bankStatement(ctx, link.id, null, { fetcher: failing })).toEqual({
      ok: false,
      code: "limite",
    });
    expect((await mineOf(me)).errorCode).toBe("limite");
    expect((await mineOf(spouse)).errorCode).toBeNull();
  });

  it("remover uma chave apaga só ela, e o que foi importado fica", async () => {
    const mine = await mineOf(me);
    expect(await feed.removeBank(ctx, mine.id)).toEqual({ ok: true });
    expect((await connections()).map((row) => row.personId)).toEqual([spouse]);
    expect((await links()).map((row) => row.externalId)).toEqual(["acc-dela"]);
    expect(await inH((tx) => tx.select().from(transactions))).toHaveLength(3);
    expect((await feed.loadBankConnections(ctx)).map((view) => view.personName)).toEqual(["Bia"]);
  });

  it("tirar a pessoa do cadastro leva a chave dela junto", async () => {
    await inH((tx) => tx.delete(people).where(eq(people.id, spouse)));
    expect(await connections()).toEqual([]);
    expect(await links()).toEqual([]);
  });
});
