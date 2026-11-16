// Transferência entre contas da casa que chega pelo banco como duas linhas (ADR-0042), contra um Postgres
// real com RLS: as duas viram uma transferência, não voltam na próxima atualização e podem ser desfeitas.
// Tudo fictício.
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
const auto = await import("@/lib/bank-auto");
const { pairBankTransfers } = await import("@/lib/bank-transfers");
const { loadMonth, loadTransfers } = await import("@/lib/finance-data");
const { deleteTransfer } = await import("@/app/app/(painel)/contas/actions");

const { accounts, accountTransfers, eq, people, transactions } = db;
const { household, householdMember, householdSettings, user } = db;

const H = { household: "hh-transf", owner: "user-transf" };
const inH = <T>(fn: Parameters<typeof db.withWorkerHousehold<T>>[1]) =>
  db.withWorkerHousehold(H.household, fn);
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

let ana = "";
let beto = "";
let anaBank = "";
let anaInvest = "";
let betoBank = "";
let home = "";

let serial = 0;
const row = (
  kind: "receita" | "despesa",
  amount: string,
  date: string,
  description: string,
  externalId = `pluggy:t${(serial += 1)}`,
) => ({ date, description, amount, kind, externalId });
const entries = () => inH((tx) => tx.select().from(transactions));
const transfers = () => inH((tx) => tx.select().from(accountTransfers));
const balances = async () => {
  const { accounts: rows } = await inH((tx) => db.accountBalances(tx));
  return Object.fromEntries(rows.map((account) => [account.name, account.balance]));
};

beforeAll(async () => {
  await db.withAdmin("seed do teste de transferência do banco", async (admin) => {
    await admin
      .insert(user)
      .values({ id: H.owner, name: "Titular", email: "titular-transf@example.com" });
    await admin.insert(household).values({ id: H.household, name: "Casa", slug: "hh-transf" });
    await admin
      .insert(householdMember)
      .values({ id: "m-transf-1", organizationId: H.household, userId: H.owner, role: "owner" });
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
      .values({ householdId: H.household, name: "Ana Souza", relation: "titular" })
      .returning({ id: people.id });
    const [second] = await tx
      .insert(people)
      .values({ householdId: H.household, name: "Beto Lima", relation: "outro" })
      .returning({ id: people.id });
    ana = first!.id;
    beto = second!.id;
    const rows = await tx
      .insert(accounts)
      .values([
        { householdId: H.household, name: "Ana corrente", openingBalance: "5000.00" },
        { householdId: H.household, name: "Ana investimento", openingBalance: "1000.00" },
        { householdId: H.household, name: "Beto corrente", openingBalance: "2000.00" },
        { householdId: H.household, name: "Casa" },
      ])
      .returning({ id: accounts.id, name: accounts.name });
    const idOf = (name: string) => rows.find((account) => account.name === name)!.id;
    anaBank = idOf("Ana corrente");
    anaInvest = idOf("Ana investimento");
    betoBank = idOf("Beto corrente");
    home = idOf("Casa");
    // Onde a importação põe o que não sabe classificar: toda família nasce com as duas.
    await tx.insert(db.categories).values([
      { householdId: H.household, name: "Outras despesas", kind: "despesa" },
      { householdId: H.household, name: "Outras receitas", kind: "receita" },
    ]);
    const connect = async (personId: string, item: string, linked: string[]) => {
      const [connection] = await tx
        .insert(db.bankConnections)
        .values({
          householdId: H.household,
          userId: H.owner,
          personId,
          clientIdSealed: "x",
          clientSecretSealed: "y",
          itemIds: [item],
        })
        .returning({ id: db.bankConnections.id });
      await tx.insert(db.bankConnectionAccounts).values(
        linked.map((accountId, index) => ({
          householdId: H.household,
          connectionId: connection!.id,
          itemId: item,
          externalId: `${item}-${index}`,
          kind: "corrente" as const,
          name: "Conta",
          accountId,
        })),
      );
    };
    await connect(ana, "item-ana", [anaBank, anaInvest]);
    await connect(beto, "item-beto", [betoBank]);
  });
});

afterAll(() => db.closeAllPools());

describe("transferência entre contas da casa pelo extrato do banco", () => {
  const toBeto = row("despesa", "1210.00", "2026-11-13", "Pix enviado para Beto Lima da Silva");
  const fromAna = row("receita", "1210.00", "2026-11-13", "Transferência Recebida|ANA SOUZA");
  const market = row("despesa", "80.00", "2026-11-13", "SUPERMERCADO BOM PRECO");

  it("saída e entrada viram uma transferência: o mês não soma e o saldo não muda", async () => {
    await auto.autoImportStatement(ctx, anaBank, [toBeto, market]);
    await auto.autoImportStatement(ctx, betoBank, [fromAna]);
    const before = await loadMonth(ctx, "2026-11");
    expect(before.summary).toMatchObject({ received: "1210.00", spent: "1290.00" });
    const money = await balances();

    expect(await pairBankTransfers(ctx)).toBe(1);
    expect((await entries()).map((entry) => entry.description)).toEqual(["SUPERMERCADO BOM PRECO"]);
    expect(await transfers()).toMatchObject([
      {
        fromAccountId: anaBank,
        toAccountId: betoBank,
        amount: "1210.00",
        occurredOn: "2026-11-13",
        note: "Pix enviado para Beto Lima da Silva",
      },
    ]);
    const after = await loadMonth(ctx, "2026-11");
    expect(after.summary).toMatchObject({ received: "0.00", spent: "80.00" });
    expect(await balances()).toEqual(money);
    // Rodar de novo não acha mais nada.
    expect(await pairBankTransfers(ctx)).toBe(0);
  });

  it("as mesmas linhas não entram de novo na próxima atualização", async () => {
    expect(await auto.autoImportStatement(ctx, anaBank, [toBeto, market])).toEqual({
      ok: true,
      imported: 0,
      settled: 0,
    });
    expect(await auto.autoImportStatement(ctx, betoBank, [fromAna])).toEqual({
      ok: true,
      imported: 0,
      settled: 0,
    });
    expect(await entries()).toHaveLength(1);
  });

  it("na mesma pessoa, a frase do banco para conta própria basta", async () => {
    await auto.autoImportStatement(ctx, anaInvest, [
      row("despesa", "85.90", "2026-11-13", "Transferência enviada para a conta digital"),
    ]);
    await auto.autoImportStatement(ctx, anaBank, [
      row("receita", "85.90", "2026-11-13", "Transferência recebida da conta investimento"),
    ]);
    expect(await pairBankTransfers(ctx)).toBe(1);
    expect(await transfers()).toHaveLength(2);
    expect(await entries()).toHaveLength(1);
  });

  it("sem confirmação no extrato, ou com a categoria escolhida pela família, fica como está", async () => {
    // Mesmo valor e mesmo dia, mas a entrada veio de outra pessoa.
    await auto.autoImportStatement(ctx, anaBank, [
      row("despesa", "100.00", "2026-11-14", "Pix enviado para Beto Lima"),
    ]);
    await auto.autoImportStatement(ctx, betoBank, [
      row("receita", "100.00", "2026-11-14", "Transferência Recebida|Carla Dias"),
    ]);
    // Par legítimo, mas a família já disse que a saída é uma despesa.
    await auto.autoImportStatement(ctx, anaBank, [
      row("despesa", "300.00", "2026-11-15", "Pix enviado para Beto Lima"),
    ]);
    await auto.autoImportStatement(ctx, betoBank, [
      row("receita", "300.00", "2026-11-15", "Transferência Recebida|Ana Souza"),
    ]);
    await inH((tx) =>
      tx
        .update(transactions)
        .set({ categorySource: "familia" })
        .where(eq(transactions.description, "Pix enviado para Beto Lima")),
    );
    expect(await pairBankTransfers(ctx)).toBe(0);
    expect(await entries()).toHaveLength(5);
    expect(await transfers()).toHaveLength(2);
  });

  it("desfazer devolve a saída e a entrada, que não viram transferência de novo", async () => {
    const listed = await loadTransfers(ctx);
    const bank = listed.rows.find((item) => item.amount === "1210.00")!;
    expect(bank.fromBank).toBe(true);
    const money = await balances();
    await deleteTransfer(form({ id: bank.id }));

    expect(await transfers()).toHaveLength(1);
    const back = (await entries()).filter((entry) => entry.amount === "1210.00");
    expect(back.map((entry) => [entry.kind, entry.accountId, entry.description]).sort()).toEqual(
      [
        ["despesa", anaBank, "Pix enviado para Beto Lima da Silva"],
        ["receita", betoBank, "Transferência Recebida|ANA SOUZA"],
      ].sort(),
    );
    expect(back.every((entry) => entry.categorySource === "familia")).toBe(true);
    expect(await balances()).toEqual(money);
    expect(await pairBankTransfers(ctx)).toBe(0);
    // E o banco não traz as duas linhas outra vez.
    expect(await auto.autoImportStatement(ctx, anaBank, [toBeto])).toMatchObject({ imported: 0 });
    expect(await auto.autoImportStatement(ctx, betoBank, [fromAna])).toMatchObject({ imported: 0 });
  });

  it("transferência lançada à mão não se repete quando o banco mostra as duas pontas", async () => {
    await inH((tx) =>
      tx.insert(accountTransfers).values({
        householdId: H.household,
        fromAccountId: anaBank,
        toAccountId: home,
        amount: "450.00",
        occurredOn: "2026-11-16",
      }),
    );
    const count = (await entries()).length;
    expect(
      await auto.autoImportStatement(ctx, anaBank, [
        row("despesa", "450.00", "2026-11-16", "Pix enviado para Ana Souza"),
      ]),
    ).toMatchObject({ imported: 0 });
    expect(await entries()).toHaveLength(count);
    // Desfazer a lançada à mão só apaga a transferência.
    const manual = (await loadTransfers(ctx)).rows.find((item) => item.amount === "450.00")!;
    expect(manual.fromBank).toBe(false);
    await deleteTransfer(form({ id: manual.id }));
    expect(await entries()).toHaveLength(count);
  });
});
