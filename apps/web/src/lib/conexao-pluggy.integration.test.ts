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
const domain = await import("@organizeup/domain");
const feed = await import("@/lib/bank-feed");
const cardFeed = await import("@/lib/bank-feed-cards");
const auto = await import("@/lib/bank-auto");
const { commitImport, prepareImport } = await import("@/app/app/(painel)/importar/actions");

const { accounts, bankConnectionAccounts, bankConnections, categories, eq, transactions } = db;
const { cardPurchases, cashflowPlans, creditCards, householdReports, importBatches } = db;
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
// Linhas do cartão: uma à vista, uma compra em 3 parcelas (a 2ª e a 3ª já lançadas), um pagamento e um pendente.
const meta = (installmentNumber: number, totalInstallments: number, purchaseDate?: string) => ({
  installmentNumber,
  totalInstallments,
  ...(purchaseDate ? { purchaseDate } : {}),
});
const cardRemote = {
  transactions: [
    {
      id: "k1",
      date: "2026-11-02T14:35:00.000Z",
      description: "RESTAURANTE BOM",
      type: "DEBIT",
      amount: 80,
      status: "POSTED",
      creditCardMetadata: meta(1, 1),
    },
    {
      id: "k2",
      date: "2026-10-05T03:00:00.000Z",
      description: "LOJA DE MOVEIS",
      type: "DEBIT",
      amount: 100,
      status: "POSTED",
      creditCardMetadata: meta(2, 3, "2026-09-04T03:00:00.000Z"),
    },
    {
      id: "k3",
      date: "2026-11-05T03:00:00.000Z",
      description: "LOJA DE MOVEIS",
      type: "DEBIT",
      amount: 100,
      status: "POSTED",
      creditCardMetadata: meta(3, 3, "2026-09-04T03:00:00.000Z"),
    },
    {
      id: "k4",
      date: "2026-10-20T03:00:00.000Z",
      description: "PAGAMENTO DE FATURA",
      type: "CREDIT",
      amount: -500,
      status: "POSTED",
    },
    {
      id: "k5",
      date: "2026-11-08T03:00:00.000Z",
      description: "POSTO",
      type: "DEBIT",
      amount: 150,
      status: "PENDING",
    },
  ] as Array<Record<string, unknown>>,
};
// Compras e vendas de cada investimento, por identificador. Sem entrada: a Pluggy devolve lista vazia.
const tradesRemote: Record<string, { status: number; results: Array<Record<string, unknown>> }> =
  {};
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
  // Cada aplicação só enxerga as conexões criadas nela.
  if (url.pathname.startsWith("/items/")) {
    return url.pathname === `/items/${item}`
      ? json({ id: item })
      : json({ message: "não achado" }, 404);
  }
  if (url.pathname === "/accounts") {
    return url.searchParams.get("itemId") === item
      ? json({ results: mine ? remote.accounts : spouseRemote.accounts })
      : json({ message: "não achado" }, 404);
  }
  if (url.pathname === "/v2/transactions") {
    const account = url.searchParams.get("accountId");
    if (mine && account === "acc-corrente")
      return json({ results: remote.transactions, next: null });
    if (mine && account === "acc-cartao")
      return json({ results: cardRemote.transactions, next: null });
    if (!mine && account === "acc-dela")
      return json({ results: spouseRemote.transactions, next: null });
    return json({}, 404);
  }
  const trades = /^\/investments\/([^/]+)\/transactions$/.exec(url.pathname);
  if (trades) {
    const known = tradesRemote[trades[1]!];
    if (!known) return json({ results: [], totalPages: 1 });
    return known.status === 200
      ? json({ results: known.results, totalPages: 1 })
      : json({ message: "sem acesso" }, known.status);
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

  it("recusa a conexão criada em outra aplicação, em vez de salvar sem contas", async () => {
    // O Item ID existe, mas é da aplicação da outra chave: a lista de contas viria vazia, sem erro.
    calls.length = 0;
    expect(await feed.connectBank(ctx, keys({ itemIds: SPOUSE_ITEM }), options)).toEqual({
      ok: false,
      code: "conexao",
    });
    expect(calls).toEqual(["POST /auth", `GET /items/${SPOUSE_ITEM}`]);
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
    expect(result.estimated).toEqual([]);
    expect(result.classes).toEqual({});
    expect(result.file.ignored).toEqual([
      { line: 1, label: "CDB Banco X", date: null, reason: "ativo_nao_listado" },
    ]);
  });

  it("tira o preço pago das compras e vendas, e estima quando o histórico não chega", async () => {
    const before = remote.investments;
    remote.investments = [
      {
        id: "h1",
        code: "ABEV3",
        name: "AMBEV ON",
        type: "EQUITY",
        subtype: "STOCK",
        quantity: 100,
        value: 15,
        amount: 1500,
        status: "ACTIVE",
      },
      {
        id: "h2",
        code: "BBAS3",
        name: "BRASIL ON",
        type: "EQUITY",
        subtype: "STOCK",
        quantity: 100,
        value: 30,
        amount: 3000,
        status: "ACTIVE",
      },
      {
        id: "h3",
        code: "TRXF11",
        name: "TRX FII",
        type: "EQUITY",
        subtype: "REAL_ESTATE_FUND",
        quantity: 10,
        value: 115,
        amount: 1150,
        status: "ACTIVE",
      },
    ];
    tradesRemote.h1 = {
      status: 200,
      results: [
        { type: "BUY", quantity: 60, value: 10, amount: 600, date: "2026-03-10T03:00:00.000Z" },
        { type: "BUY", quantity: 40, value: 15, amount: 600, date: "2026-05-10T03:00:00.000Z" },
      ],
    };
    tradesRemote.h2 = {
      status: 200,
      results: [
        { type: "BUY", quantity: 40, value: 20, amount: 800, date: "2026-05-10T03:00:00.000Z" },
      ],
    };
    try {
      calls.length = 0;
      const result = await feed.bankPortfolio(ctx, options);
      if (!result.ok) throw new Error(result.code);
      const line = Object.fromEntries(
        result.file.positions.map((row) => [row.ticker, String(row.line)]),
      );
      // ABEV3: o histórico explica as 100. BBAS3: só 40 das 100. TRXF11: nenhuma compra. PETR4 vem da outra chave.
      expect(result.paid[line.ABEV3!]).toBe("12");
      expect(result.paid[line.BBAS3!]).toBe("20");
      expect(result.paid[line.TRXF11!]).toBe("115");
      expect(result.paid[line.PETR4!]).toBe("36");
      expect(result.estimated.sort()).toEqual([line.BBAS3!, line.TRXF11!].sort());
      expect(result.classes).toMatchObject({ ABEV3: "acao", BBAS3: "acao", TRXF11: "fii" });
      // Quem já informa o valor aplicado não gasta chamada.
      expect(calls.filter((call) => call.endsWith("/transactions"))).toHaveLength(3);

      // A corretora não libera o histórico: uma tentativa só, e o preço de hoje como estimativa.
      tradesRemote.h1 = { status: 403, results: [] };
      calls.length = 0;
      const blocked = await feed.bankPortfolio(ctx, options);
      if (!blocked.ok) throw new Error(blocked.code);
      expect(calls.filter((call) => call.endsWith("/transactions"))).toHaveLength(1);
      expect(blocked.paid[line.ABEV3!]).toBe("15");
      expect(blocked.estimated).toHaveLength(3);
      expect((await mineOf(me)).errorCode).toBeNull();
    } finally {
      remote.investments = before;
      delete tradesRemote.h1;
      delete tradesRemote.h2;
    }
  });

  it("cria a conta daqui a partir da conta do banco, uma a uma ou todas de uma vez", async () => {
    const global = await linkOf("acc-dolar");
    expect(await feed.linkBankAccount(ctx, global.id, "")).toEqual({ ok: true });
    expect(await feed.linkBankAccount(ctx, global.id, feed.BANK_CREATE)).toEqual({ ok: true });
    const linked = await linkOf("acc-dolar");
    const [made] = await inH((tx) =>
      tx.select().from(accounts).where(eq(accounts.id, linked.accountId!)),
    );
    expect(made).toMatchObject({ name: "Global", currency: "USD", type: "corrente" });
    expect(linked.accountId).not.toBe(dollars);

    const her = await linkOf("acc-dela");
    const theirs = await mineOf(spouse);
    expect(await feed.linkBankAccount(ctx, her.id, "")).toEqual({ ok: true });
    expect(await feed.createMissingAccounts(ctx, theirs.id)).toEqual({ ok: true, created: 1 });
    const again = await linkOf("acc-dela");
    const [auto] = await inH((tx) =>
      tx.select().from(accounts).where(eq(accounts.id, again.accountId!)),
    );
    expect(auto!.name).toBe("Conta dela · 9876");
    // Nada mais falta: chamar de novo não cria outra.
    expect(await feed.createMissingAccounts(ctx, theirs.id)).toEqual({ ok: true, created: 0 });
    expect(await feed.createMissingAccounts(partner, theirs.id)).toEqual({
      ok: false,
      code: "sem_conexao",
    });
    expect(await feed.linkBankAccount(ctx, her.id, hers)).toEqual({ ok: true });
  });

  it("cria o cartão daqui a partir do cartão do banco", async () => {
    const card = await linkOf("acc-cartao");
    const checking = await linkOf("acc-corrente");
    const create = (over: Record<string, unknown> = {}) =>
      feed.linkBankCard(ctx, card.id, {
        cardId: feed.BANK_CREATE,
        closingDay: 25,
        dueDay: 1,
        payingAccountId: real,
        ...over,
      });
    expect(await feed.linkBankCard(ctx, checking.id, { cardId: feed.BANK_CREATE })).toEqual({
      ok: false,
      code: "nao_e_cartao",
    });
    expect(await create({ closingDay: 40 })).toEqual({ ok: false, code: "dias_invalidos" });
    expect(await create({ dueDay: Number.NaN })).toEqual({ ok: false, code: "dias_invalidos" });
    expect(await create({ payingAccountId: "outra" })).toEqual({
      ok: false,
      code: "conta_invalida",
    });
    expect(await feed.linkBankCard(partner, card.id, { cardId: "" })).toEqual({
      ok: false,
      code: "sem_conexao",
    });
    expect(await cardFeed.prepareCardFeed(ctx, card.id, null, options)).toEqual({
      ok: false,
      code: "cartao_invalido",
    });
    expect(await create()).toEqual({ ok: true });
    const linked = await linkOf("acc-cartao");
    const [made] = await inH((tx) =>
      tx.select().from(creditCards).where(eq(creditCards.id, linked.cardId!)),
    );
    expect(made).toMatchObject({
      name: "Cartão · 4321",
      closingDay: 25,
      dueDay: 1,
      payingAccountId: real,
    });
    const [view] = await feed.loadBankConnections(ctx);
    expect(view!.links.find((link) => link.kind === "cartao")!.cardId).toBe(made!.id);
  });

  it("traz as compras do cartão para a conferência, com a parcelada numa compra só", async () => {
    const card = await linkOf("acc-cartao");
    const checking = await linkOf("acc-corrente");
    expect(await cardFeed.prepareCardFeed(ctx, checking.id, null, options)).toEqual({
      ok: false,
      code: "nao_e_cartao",
    });
    expect(await cardFeed.prepareCardFeed(partner, card.id, null, options)).toEqual({
      ok: false,
      code: "sem_conexao",
    });
    const fetched = await cardFeed.prepareCardFeed(ctx, card.id, "2026-09-01", options);
    if (!fetched.ok) throw new Error(fetched.code);
    expect(fetched.pending).toBe(1);
    expect(fetched.credits).toBe(1);
    expect(
      fetched.rows.map((row) => [
        row.date,
        row.description,
        row.amount,
        row.installments,
        row.state,
      ]),
    ).toEqual([
      ["2026-10-05", "LOJA DE MOVEIS (desde 2/3)", "200.00", 2, "novo"],
      ["2026-11-02", "RESTAURANTE BOM", "80.00", 1, "novo"],
    ]);
    // Buscar não grava.
    expect(await inH((tx) => tx.select().from(cardPurchases))).toEqual([]);

    const chosen = fetched.rows.map((row) => ({
      date: row.date,
      description: row.description,
      amount: row.amount,
      installments: row.installments,
      fingerprint: row.fingerprint,
      categoryId: row.description.startsWith("LOJA") ? expense : null,
      newCategory: row.description.startsWith("LOJA")
        ? null
        : { name: "Restaurante", essential: false },
    }));
    expect(await cardFeed.commitCardFeed(partner, card.id, chosen)).toEqual({
      ok: false,
      code: "sem_conexao",
    });
    expect(
      await cardFeed.commitCardFeed(ctx, card.id, [{ ...chosen[0]!, categoryId: income }]),
    ).toEqual({ ok: false, code: "dados_invalidos" });
    expect(await cardFeed.commitCardFeed(ctx, card.id, chosen)).toEqual({
      ok: true,
      imported: 2,
      repeated: 0,
      blocked: 0,
    });
    const saved = await inH((tx) => tx.select().from(cardPurchases));
    expect(
      saved.map((row) => [row.description, row.amount, row.installments, row.purchasedOn]).sort(),
    ).toEqual([
      ["LOJA DE MOVEIS (desde 2/3)", "200.00", 2, "2026-10-05"],
      ["RESTAURANTE BOM", "80.00", 1, "2026-11-02"],
    ]);
    expect(saved.every((row) => row.cardId === card.cardId)).toBe(true);
    const made = await inH((tx) =>
      tx.select().from(categories).where(eq(categories.name, "Restaurante")),
    );
    expect(made).toHaveLength(1);

    // Reenviar as mesmas linhas não duplica, e a parcela seguinte é a mesma compra.
    expect(await cardFeed.commitCardFeed(ctx, card.id, chosen)).toEqual({
      ok: true,
      imported: 0,
      repeated: 2,
      blocked: 0,
    });
    cardRemote.transactions = cardRemote.transactions.filter((row) => row.id !== "k2");
    const later = await cardFeed.prepareCardFeed(ctx, card.id, "2026-11-01", options);
    if (!later.ok) throw new Error(later.code);
    expect(later.rows.map((row) => [row.description, row.state])).toEqual([
      ["RESTAURANTE BOM", "importado"],
      ["LOJA DE MOVEIS (desde 3/3)", "importado"],
    ]);
    expect(await inH((tx) => tx.select().from(cardPurchases))).toHaveLength(2);
  });

  it("um cartão daqui recebe um cartão do banco só", async () => {
    const card = await linkOf("acc-cartao");
    await inH((tx) =>
      tx.insert(bankConnectionAccounts).values({
        householdId: H.household,
        connectionId: card.connectionId,
        itemId: ITEM,
        externalId: "acc-cartao-2",
        kind: "cartao",
        name: "Outro cartão",
      }),
    );
    const other = await linkOf("acc-cartao-2");
    expect(await feed.linkBankCard(ctx, other.id, { cardId: card.cardId! })).toEqual({
      ok: false,
      code: "cartao_em_uso",
    });
    expect(await feed.linkBankCard(ctx, other.id, { cardId: "não existe" })).toEqual({
      ok: false,
      code: "cartao_invalido",
    });
    await inH((tx) =>
      tx.delete(bankConnectionAccounts).where(eq(bankConnectionAccounts.id, other.id)),
    );
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
    expect(rows.find((row) => row.externalId === "acc-cartao")!.cardId).not.toBeNull();
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

  it("a atualização automática grava só o que é novo, num lote com Desfazer", async () => {
    const batchesBefore = (await inH((tx) => tx.select().from(importBatches))).length;
    const result = await auto.syncOwnBanks(ctx, { options });
    // PADARIA saiu de pendente e ainda não tinha entrado. O resto já estava, em conta e em cartão.
    expect(result).toMatchObject({ entries: 1, settled: 0, purchases: 0 });
    const rows = await inH((tx) => tx.select().from(transactions));
    expect(rows).toHaveLength(4);
    const bread = rows.find((row) => row.description === "PADARIA")!;
    expect(bread).toMatchObject({
      accountId: real,
      kind: "despesa",
      amount: "12.50",
      status: "realizado",
      createdBy: H.owner,
    });
    expect(bread.importBatchId).not.toBeNull();
    expect(["revisar", "importacao"]).toContain(bread.categorySource);
    const batches = await inH((tx) => tx.select().from(importBatches));
    expect(batches).toHaveLength(batchesBefore + 1);
    const reports = await inH((tx) =>
      tx.select().from(householdReports).where(eq(householdReports.period, bread.importBatchId!)),
    );
    expect(reports).toHaveLength(1);
    expect((await mineOf(me)).autoRanAt).not.toBeNull();
  });

  it("dá baixa na conta prevista em vez de lançar de novo, e respeita o que foi digitado à mão", async () => {
    // Aluguel previsto todo dia 10, e um mercado que a família já lançou à mão.
    await inH(async (tx) => {
      await tx.insert(cashflowPlans).values({
        householdId: H.household,
        accountId: real,
        categoryId: expense,
        kind: "despesa",
        description: "Aluguel",
        amount: "1800.00",
        dayOfMonth: 10,
        startMonth: "2026-11",
      });
      await tx.insert(transactions).values({
        householdId: H.household,
        accountId: real,
        categoryId: expense,
        kind: "despesa",
        description: "Feira",
        amount: "55.00",
        occurredOn: "2026-11-09",
        status: "realizado",
      });
    });
    const before = (await inH((tx) => tx.select().from(transactions))).length;
    const saved = await auto.autoImportStatement(ctx, real, [
      {
        date: "2026-11-10",
        description: "PAGTO ALUGUEL",
        amount: "1800.00",
        kind: "despesa",
        externalId: "pluggy:a1",
      },
      {
        date: "2026-11-09",
        description: "FEIRA LIVRE",
        amount: "55.00",
        kind: "despesa",
        externalId: "pluggy:a2",
      },
      {
        date: "2026-11-09",
        description: "UBER VIAGEM",
        amount: "23.40",
        kind: "despesa",
        externalId: "pluggy:a3",
      },
    ]);
    expect(saved).toEqual({ ok: true, imported: 1, settled: 1 });
    const rows = await inH((tx) => tx.select().from(transactions));
    // Entraram o Uber e a baixa do aluguel; a feira digitada não ganhou uma cópia.
    expect(rows).toHaveLength(before + 2);
    expect(rows.filter((row) => row.amount === "55.00")).toHaveLength(1);
    const rent = rows.find((row) => row.amount === "1800.00")!;
    expect(rent).toMatchObject({ status: "realizado", importFingerprint: "ofx:id:pluggy:a1#0" });
    expect(rent.planId).not.toBeNull();
    // De novo, nada muda.
    expect(
      await auto.autoImportStatement(ctx, real, [
        {
          date: "2026-11-10",
          description: "PAGTO ALUGUEL",
          amount: "1800.00",
          kind: "despesa",
          externalId: "pluggy:a1",
        },
        {
          date: "2026-11-09",
          description: "UBER VIAGEM",
          amount: "23.40",
          kind: "despesa",
          externalId: "pluggy:a3",
        },
      ]),
    ).toEqual({ ok: true, imported: 0, settled: 0 });
    expect(
      await auto.autoImportStatement(ctx, dollars, [
        {
          date: "2026-11-09",
          description: "CAFE",
          amount: "5.00",
          kind: "despesa",
          externalId: "pluggy:u1",
        },
      ]),
    ).toEqual({ ok: false, code: "moeda_estrangeira" });
    expect(
      await auto.autoImportStatement(db.readOnlyContext(ctx), real, [
        {
          date: "2026-11-09",
          description: "CAFE",
          amount: "5.00",
          kind: "despesa",
          externalId: "pluggy:u2",
        },
      ]),
    ).toEqual({ ok: false, code: "sem_permissao" });
    // Deixa a contagem como estava para os testes seguintes.
    await inH(async (tx) => {
      await tx.delete(transactions).where(eq(transactions.amount, "1800.00"));
      await tx.delete(transactions).where(eq(transactions.amount, "55.00"));
      await tx.delete(transactions).where(eq(transactions.amount, "23.40"));
      await tx.delete(cashflowPlans);
    });
  });

  it("não roda de novo antes do intervalo, e rodar de novo não duplica", async () => {
    expect(await auto.syncOwnBanks(ctx, { options })).toBeNull();
    const again = await auto.syncOwnBanks(ctx, { minHours: 0, options });
    expect(again).toMatchObject({ entries: 0, settled: 0, purchases: 0 });
    expect(await inH((tx) => tx.select().from(transactions))).toHaveLength(4);
    expect(await inH((tx) => tx.select().from(cardPurchases))).toHaveLength(2);
  });

  it("desligada, nada entra sozinho; e outro login não liga nem desliga", async () => {
    const mine = await mineOf(me);
    const theirs = await mineOf(spouse);
    expect(await auto.syncOwnBanks(partner, { minHours: 0, options })).toBeNull();
    expect(await feed.setBankAuto(partner, mine.id, false)).toEqual({
      ok: false,
      code: "sem_conexao",
    });
    expect(await feed.setBankAuto(ctx, mine.id, false)).toEqual({ ok: true });
    expect(await feed.setBankAuto(ctx, theirs.id, false)).toEqual({ ok: true });
    expect(await auto.syncOwnBanks(ctx, { minHours: 0, options })).toBeNull();
    expect(await feed.setBankAuto(ctx, mine.id, true)).toEqual({ ok: true });
    expect(await feed.setBankAuto(ctx, theirs.id, true)).toEqual({ ok: true });
    const [view] = await feed.loadBankConnections(ctx);
    expect(view!.autoEnabled).toBe(true);
  });

  it("a rodada do Paperclip percorre as conexões ligadas e deixa só contagens", async () => {
    await inH((tx) => tx.update(bankConnections).set({ autoRanAt: null }));
    // Uma compra nova no cartão desde a última rodada.
    cardRemote.transactions.push({
      id: "k9",
      date: "2026-11-09T12:00:00.000Z",
      description: "LIVRARIA",
      type: "DEBIT",
      amount: 60,
      status: "POSTED",
      creditCardMetadata: meta(1, 1),
    });
    const counts = await auto.syncAllBanks(options);
    expect(counts.households).toBe(1);
    expect(counts.ok + counts.failed).toBe(1);
    expect(counts.applied).toBe(1);
    expect(await inH((tx) => tx.select().from(cardPurchases))).toHaveLength(3);
    expect(await db.hasAgentRunToday(domain.todayIn(), auto.BANCOS_AGENT)).toBe(true);
  });

  it("remover uma chave apaga só ela, e o que foi importado fica", async () => {
    const mine = await mineOf(me);
    expect(await feed.removeBank(ctx, mine.id)).toEqual({ ok: true });
    expect((await connections()).map((row) => row.personId)).toEqual([spouse]);
    expect((await links()).map((row) => row.externalId)).toEqual(["acc-dela"]);
    expect(await inH((tx) => tx.select().from(transactions))).toHaveLength(4);
    expect((await feed.loadBankConnections(ctx)).map((view) => view.personName)).toEqual(["Bia"]);
  });

  it("tirar a pessoa do cadastro leva a chave dela junto", async () => {
    await inH((tx) => tx.delete(people).where(eq(people.id, spouse)));
    expect(await connections()).toEqual([]);
    expect(await links()).toEqual([]);
  });
});
