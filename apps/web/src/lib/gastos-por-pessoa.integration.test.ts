// De quem é cada lançamento e quanto cada pessoa gastou no mês, contra um Postgres real com RLS: a conta
// ligada ao banco é da pessoa da chave, a escolha da tela vale mais, e a fatura é de quem é o cartão. Tudo
// fictício.
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
    getMessages: async () => messages,
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
const { loadMonth, loadOverview } = await import("@/lib/finance-data");
const { loadOwnerChoices } = await import("@/lib/owners");
const { saveAccount } = await import("@/app/app/(painel)/contas/actions");
const { payStatement, saveCard } = await import("@/app/app/(painel)/cartoes/actions");

const { accounts, categories, creditCards, cardPurchases, people, transactions } = db;
const { household, householdMember, householdSettings, user } = db;

const H = { household: "hh-pessoa", owner: "user-pessoa" };
const inH = <T>(fn: Parameters<typeof db.withWorkerHousehold<T>>[1]) =>
  db.withWorkerHousehold(H.household, fn);
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const idle = { ok: false, message: null };

let ana = "";
let beto = "";
let anaBank = "";
let betoWallet = "";
let home = "";
let card = "";
let month = "";

beforeAll(async () => {
  await db.withAdmin("seed do teste de gastos por pessoa", async (admin) => {
    await admin
      .insert(user)
      .values({ id: H.owner, name: "Titular", email: "titular-pessoa@example.com" });
    await admin.insert(household).values({ id: H.household, name: "Casa", slug: "hh-pessoa" });
    await admin
      .insert(householdMember)
      .values({ id: "m-pessoa-1", organizationId: H.household, userId: H.owner, role: "owner" });
  });
  const made = await db.fromSession({
    user: { id: H.owner },
    session: { activeOrganizationId: H.household },
  });
  if (!made) throw new Error("sem contexto");
  ctx = made;
  await inH(async (tx) => {
    await tx.insert(householdSettings).values({ householdId: H.household });
    const [first] = await tx
      .insert(people)
      .values({ householdId: H.household, name: "Ana", relation: "titular" })
      .returning({ id: people.id });
    const [second] = await tx
      .insert(people)
      .values({ householdId: H.household, name: "Beto", relation: "outro" })
      .returning({ id: people.id });
    ana = first!.id;
    beto = second!.id;
    const rows = await tx
      .insert(accounts)
      .values([
        { householdId: H.household, name: "Banco da Ana" },
        { householdId: H.household, name: "Carteira do Beto" },
        { householdId: H.household, name: "Casa" },
      ])
      .returning({ id: accounts.id, name: accounts.name });
    anaBank = rows.find((row) => row.name === "Banco da Ana")!.id;
    betoWallet = rows.find((row) => row.name === "Carteira do Beto")!.id;
    home = rows.find((row) => row.name === "Casa")!.id;
    const cats = await tx
      .insert(categories)
      .values([
        { householdId: H.household, name: "Mercado", kind: "despesa" },
        { householdId: H.household, name: domain.CARD_CATEGORY, kind: "despesa" },
        { householdId: H.household, name: "Salário", kind: "receita" },
      ])
      .returning({ id: categories.id, name: categories.name });
    const market = cats.find((row) => row.name === "Mercado")!.id;
    const salary = cats.find((row) => row.name === "Salário")!.id;
    const [made] = await tx
      .insert(creditCards)
      .values({
        householdId: H.household,
        name: "Cartão",
        closingDay: 25,
        dueDay: 5,
        payingAccountId: anaBank,
      })
      .returning();
    card = made!.id;
    month = domain.statementMonthOf("2026-10-10", made!);
    await tx.insert(cardPurchases).values({
      householdId: H.household,
      cardId: card,
      categoryId: market,
      description: "Loja",
      amount: "300.00",
      installments: 1,
      purchasedOn: "2026-10-10",
    });
    // A conta e o cartão vieram pela chave do banco da Ana.
    const [connection] = await tx
      .insert(db.bankConnections)
      .values({
        householdId: H.household,
        userId: H.owner,
        personId: ana,
        clientIdSealed: "x",
        clientSecretSealed: "y",
        itemIds: ["item-1"],
      })
      .returning({ id: db.bankConnections.id });
    const link = { householdId: H.household, connectionId: connection!.id, itemId: "item-1" };
    await tx.insert(db.bankConnectionAccounts).values([
      { ...link, externalId: "conta", kind: "corrente", name: "Conta", accountId: anaBank },
      { ...link, externalId: "cartao", kind: "cartao", name: "Cartão", cardId: card },
    ]);
    const spend = (accountId: string, amount: string, description: string) => ({
      householdId: H.household,
      accountId,
      categoryId: market,
      kind: "despesa" as const,
      description,
      amount,
      occurredOn: `${month}-03`,
    });
    await tx
      .insert(transactions)
      .values([
        spend(anaBank, "100.00", "Feira"),
        spend(betoWallet, "250.00", "Mercado do mês"),
        spend(home, "40.00", "Padaria"),
        { ...spend(anaBank, "1000.00", "Salário"), kind: "receita", categoryId: salary },
      ]);
  });
});

afterAll(() => db.closeAllPools());

const keyOf = (data: Awaited<ReturnType<typeof loadMonth>>, description: string) =>
  data.entries.find((entry) => entry.description === description)!.key;

describe("de quem é cada lançamento", () => {
  it("a conta e o cartão ligados ao banco são da pessoa da chave; o resto é de uso comum", async () => {
    const data = await loadMonth(ctx, month);
    expect(data.people.list).toEqual([{ id: ana, name: "Ana", slot: 1 }]);
    expect(data.people.of[keyOf(data, "Feira")]).toBe(ana);
    expect(data.people.of[keyOf(data, "Salário")]).toBe(ana);
    expect(data.people.of[keyOf(data, "Mercado do mês")]).toBeUndefined();
    expect(data.people.of[`f:${card}:${month}`]).toBe(ana);
    expect(data.people.spending).toEqual([
      { personId: ana, spent: "100.00", planned: "300.00", share: 25.6 },
      { personId: null, spent: "290.00", planned: "0.00", share: 74.4 },
    ]);
  });

  it("a escolha da tela vale mais que a do banco, na conta e no cartão", async () => {
    const wallet = await saveAccount(
      idle,
      form({
        id: betoWallet,
        name: "Carteira do Beto",
        type: "corrente",
        currency: "BRL",
        openingBalance: "",
        personId: beto,
      }),
    );
    expect(wallet.ok).toBe(true);
    const saved = await saveCard(
      idle,
      form({
        id: card,
        name: "Cartão",
        limit: "",
        closingDay: "25",
        dueDay: "5",
        payingAccountId: anaBank,
        personId: beto,
      }),
    );
    expect(saved.ok).toBe(true);
    const choices = await loadOwnerChoices(ctx);
    expect(choices.chosen).toEqual({ accounts: { [betoWallet]: beto }, cards: { [card]: beto } });
    expect(choices.bank).toEqual({ accounts: { [anaBank]: ana }, cards: { [card]: ana } });

    const data = await loadMonth(ctx, month);
    expect(data.people.list).toEqual([
      { id: ana, name: "Ana", slot: 1 },
      { id: beto, name: "Beto", slot: 2 },
    ]);
    expect(data.people.of[keyOf(data, "Mercado do mês")]).toBe(beto);
    // A fatura sai da conta da Ana, mas o cartão é do Beto.
    expect(data.people.of[`f:${card}:${month}`]).toBe(beto);
    expect(data.people.spending).toEqual([
      { personId: beto, spent: "250.00", planned: "300.00", share: 64.1 },
      { personId: ana, spent: "100.00", planned: "0.00", share: 25.6 },
      { personId: null, spent: "40.00", planned: "0.00", share: 10.3 },
    ]);
    // Fecha com o resumo do mês.
    expect(data.summary.spent).toBe("390.00");
    expect(data.summary.plannedExpense).toBe("300.00");
  });

  it("formulário sem o campo não apaga a escolha, e o campo vazio volta ao padrão", async () => {
    const fields = {
      id: betoWallet,
      name: "Carteira do Beto",
      type: "corrente",
      currency: "BRL",
      openingBalance: "",
    };
    await saveAccount(idle, form(fields));
    expect((await loadOwnerChoices(ctx)).chosen.accounts).toEqual({ [betoWallet]: beto });
    await saveAccount(idle, form({ ...fields, personId: "" }));
    expect((await loadOwnerChoices(ctx)).chosen.accounts).toEqual({});
    await saveAccount(idle, form({ ...fields, personId: "outra-casa" }));
    expect((await loadOwnerChoices(ctx)).chosen.accounts).toEqual({});
    await saveAccount(idle, form({ ...fields, personId: beto }));
  });

  it("a fatura paga continua sendo de quem é o cartão, na lista e no painel", async () => {
    const paid = await payStatement(
      { ok: false, message: "" },
      form({ cardId: card, month, paidOn: `${month}-05`, amount: "300,00", total: "300.00" }),
    );
    expect(paid.ok).toBe(true);
    const data = await loadMonth(ctx, month);
    const payment = data.entries.find(
      (entry) => entry.accountId === anaBank && entry.amount === "300.00",
    )!;
    expect(payment.key.startsWith("t:")).toBe(true);
    expect(data.people.of[payment.key]).toBe(beto);
    expect(data.people.spending[0]).toEqual({
      personId: beto,
      spent: "550.00",
      planned: "0.00",
      share: 79.7,
    });
    const overview = await loadOverview(ctx, month);
    expect(overview.people.spending).toEqual(data.people.spending);
    expect(overview.people.of[payment.key]).toBe(beto);
  });

  it("apagar a pessoa devolve a conta e o cartão ao padrão", async () => {
    await inH((tx) => tx.delete(people).where(db.eq(people.id, beto)));
    const choices = await loadOwnerChoices(ctx);
    expect(choices.chosen).toEqual({ accounts: {}, cards: {} });
    const data = await loadMonth(ctx, month);
    expect(data.people.list).toEqual([{ id: ana, name: "Ana", slot: 1 }]);
  });

  it("renda com pessoa, sem conta nem cartão com dono, não liga a separação", async () => {
    await inH(async (tx) => {
      await tx.delete(db.bankConnections);
      const [salary] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(db.eq(categories.name, "Salário"));
      await tx.insert(db.incomeSources).values({
        householdId: H.household,
        accountId: anaBank,
        categoryId: salary!.id,
        personId: ana,
        name: "Emprego",
        kind: "pj_autonomo",
        amount: "5000.00",
        payDay: 20,
        startMonth: month,
      });
    });
    const data = await loadMonth(ctx, month);
    expect(data.entries.some((entry) => entry.source === "renda")).toBe(true);
    expect(data.people).toEqual({ list: [], of: {}, spending: [] });
    expect((await loadOverview(ctx, month)).people.list).toEqual([]);
  });
});
